import { Injectable, Logger } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { OPPORTUNITY_STATES } from '../opportunities/opportunity-states';

function parseInstrumentKeysFromEnv(): string[] {
  const raw = process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS?.trim();
  if (!raw || raw.length === 0) {
    return ['BTC', 'ETH'];
  }
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

@Injectable()
export class PaperDiscoveryService {
  private readonly logger = new Logger(PaperDiscoveryService.name);

  constructor(
    @InjectRepository(ArbitrageOpportunityEntity)
    private readonly opportunityRepository: Repository<ArbitrageOpportunityEntity>,
  ) {}

  /**
   * Paper-only discovery (PRIO-P2-PAPERDISC): ensure `arbitrage_opportunities` rows exist
   * for configured instrument keys, tagged with `payload.source === 'paper_discovery'`.
   */
  async discoverPaperOpportunities(): Promise<{
    discovered: number;
    errors: number;
  }> {
    this.logger.log('Starting paper discovery scan…');
    const keys = parseInstrumentKeysFromEnv();
    let discovered = 0;
    let errors = 0;

    for (const tokenKey of keys) {
      try {
        const instrumentKey = `paper.discovery:${tokenKey}`;
        const existing = await this.opportunityRepository
          .createQueryBuilder('o')
          .where(`o.payload->>'instrumentKey' = :ik`, { ik: instrumentKey })
          .andWhere(`o.payload->>'source' = 'paper_discovery'`)
          .getOne();

        if (existing !== null) {
          continue;
        }

        const row = this.opportunityRepository.create({
          correlationId: null,
          state: OPPORTUNITY_STATES.detected,
          riskDecisionId: null,
          payload: {
            instrumentKey,
            source: 'paper_discovery',
            tokenKey,
          },
          entityVersion: 1,
        });
        await this.opportunityRepository.save(row);
        discovered += 1;
        this.logger.log(`Paper discovery created opportunity for ${tokenKey}`);
      } catch (err) {
        this.logger.error(`Paper discovery failed for token ${tokenKey}`, err);
        errors += 1;
      }
    }

    this.logger.log(
      `Paper discovery completed: ${discovered} new opportunities, ${errors} errors`,
    );
    return { discovered, errors };
  }
}
