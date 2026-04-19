import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaperDriftSampleEntity } from '@arbibot/persistence';

import type { CreateDriftSampleDto } from './dto/create-drift-sample.dto';
import { paperDriftSamplesRecorded } from './paper-drift-metrics';

@Injectable()
export class PaperDriftService {
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
      paperMid: dto.paperMid,
      referenceMid: dto.referenceMid,
      driftBps: String(dto.driftBps),
    });
    const saved = await this.repo.save(row);
    paperDriftSamplesRecorded.inc();
    return saved;
  }
}
