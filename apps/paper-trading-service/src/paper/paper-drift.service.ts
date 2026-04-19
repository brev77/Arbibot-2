import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';

import { PaperDriftSampleEntity } from '@arbibot/persistence';

import type { CreateDriftSampleDto } from './dto/create-drift-sample.dto';
import { paperDriftSamplesRecorded, paperDriftBpsCurrent, paperDriftBpsStale } from './paper-drift-metrics';

@Injectable()
export class PaperDriftService {
  private readonly logger = new Logger(PaperDriftService.name);
  private readonly STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    @InjectRepository(PaperDriftSampleEntity)
    private readonly repo: Repository<PaperDriftSampleEntity>,
  ) {}

  async list(instrumentKey: string | undefined, limit: number): Promise<PaperDriftSampleEntity[]> {
    const take = Math.min(Math.max(limit, 1), 500);
    if (instrumentKey !== undefined && instrumentKey.length > 0) {
      return this.repo.find({
        where: { instrumentKey },
        order: { capturedAt: 'DESC' },
        take,
      });
    }
    return this.repo.find({ order: { capturedAt: 'DESC' }, take });
  }

  async record(dto: CreateDriftSampleDto): Promise<PaperDriftSampleEntity> {
    const row = this.repo.create({
      instrumentKey: dto.instrumentKey,
      routeKey: dto.routeKey ?? null,
      paperMid: dto.paperMid,
      referenceMid: dto.referenceMid,
      driftBps: String(dto.driftBps),
    });
    const saved = await this.repo.save(row);
    paperDriftSamplesRecorded.inc();

    // Update the current drift gauge for this instrument
    paperDriftBpsCurrent.set(
      {
        instrumentKey: dto.instrumentKey,
        routeKey: dto.routeKey ?? 'unknown',
      },
      dto.driftBps,
    );

    return saved;
  }

  /**
   * Background job to reset gauges for instruments with stale drift samples.
   * Should be called periodically (e.g., every 5 minutes).
   */
  async updateStaleGauges(): Promise<number> {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - this.STALE_THRESHOLD_MS);

    // Find instruments with only stale samples
    const staleSamples = await this.repo
      .createQueryBuilder('sample')
      .select('sample.instrumentKey', 'instrumentKey')
      .addSelect('sample.routeKey', 'routeKey')
      .where('sample.capturedAt <= :staleThreshold', { staleThreshold })
      .distinct(true)
      .getRawMany();

    let staleCount = 0;
    for (const sample of staleSamples) {
      // Check if there's any recent sample for this instrument
      const recentCount = await this.repo.count({
        where: {
          instrumentKey: sample.instrumentKey,
          capturedAt: MoreThan(staleThreshold),
        },
      });

      if (recentCount === 0) {
        // No recent samples, reset gauge to 0
        paperDriftBpsCurrent.set(
          {
            instrumentKey: sample.instrumentKey,
            routeKey: sample.routeKey || 'unknown',
          },
          0,
        );
        staleCount++;
      }
    }

    if (staleCount > 0) {
      this.logger.log(`Reset drift gauges for ${staleCount} stale instruments`);
      paperDriftBpsStale.set(staleCount);
    } else {
      paperDriftBpsStale.set(0);
    }

    return staleCount;
  }
}
