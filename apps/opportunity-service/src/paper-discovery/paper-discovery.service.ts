import { Injectable, Logger } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { v4 as uuidv4 } from 'uuid';

import { PolicyConfigurationEntity } from '@arbibot/persistence';
import { ArbitrageOpportunityEntity } from '@arbibot/persistence';
import { PaperPromotionCandidateEntity } from '@arbibot/persistence';

import { getArbibotMetricsRegistry, getHttpRequestHistogram } from '@arbibot/nest-platform';

const METRICS_REGISTRY = getArbibotMetricsRegistry();
const HISTOGRAM = getHttpRequestHistogram();

// Metric counters
const PAPER_DISCOVERY_OPPORTUNITIES_TOTAL = METRICS_REGISTRY.createCounter({
  name: 'arb_paper_discovery_opportunities_total',
  help: 'Total paper-only opportunities discovered',
  labelNames: ['scope'],
  registers: [METRICS_REGISTRY],
});

const PAPER_DISCOVERY_ERRORS_TOTAL = METRICS_REGISTRY.createCounter({
  name: 'arb_paper_discovery_errors_total',
  help: 'Total paper discovery errors',
  labelNames: ['error_type'],
  registers: [METRICS_REGISTRY],
});

@Injectable()
export class PaperDiscoveryService {
  private readonly logger = new Logger(PaperDiscoveryService.name);

  constructor(
    @InjectRepository(ArbitrageOpportunityEntity)
    private readonly opportunityRepository: Repository<ArbitrageOpportunityEntity>,
    @InjectRepository(PaperPromotionCandidateEntity)
    private readonly paperCandidateRepository: Repository<PaperPromotionCandidateEntity>,
    @InjectRepository(PolicyConfigurationEntity)
    private readonly configRepository: Repository<PolicyConfigurationEntity>,
  ) {}

  /**
   * Discover paper-only opportunities.
   * Finds tokens with paper-only status and creates paper promotion candidates.
   */
  async discoverPaperOpportunities(): Promise<{
    discovered: number;
    errors: number;
  }> {
    this.logger.log('Starting paper discovery scan...');

    let discovered = 0;
    let errors = 0;

    try {
      // Find tokens with paper-only status
      // Note: For Phase 3 slice, we'll simulate paper-only tokens
      // In production, this would query from a token status service
      const paperOnlyTokens = await this.getPaperOnlyTokens();

      this.logger.log(`Found ${paperOnlyTokens.length} paper-only tokens`);

      // For each paper-only token, check for existing opportunities
      for (const token of paperOnlyTokens) {
        try {
          const existingCandidate =
            await this.findExistingPaperCandidate(token.tokenKey);

          if (existingCandidate) {
            this.logger.debug(
              `Skipping ${token.tokenKey}: candidate already exists (status: ${existingCandidate.status})`,
            );
            continue;
          }

          // Create paper promotion candidate
          const candidate = await this.createPaperCandidate(token);

          // Create opportunity if not exists
          await this.createPaperOpportunity(token, candidate);

          discovered++;
        } catch (error) {
          this.logger.error(
            `Failed to create candidate for token ${token.tokenKey}:`,
            error,
          );
          PAPER_DISCOVERY_ERRORS_TOTAL.inc({ error_type: 'token_processing' });
          errors++;
        }
      }

      this.logger.log(`Paper discovery completed: ${discovered} candidates created`);
    } catch (error) {
      this.logger.error('Paper discovery failed:', error);
      PAPER_DISCOVERY_ERRORS_TOTAL.inc({ error_type: 'scan_failure' });
      errors++;
    }

    // Record metrics
    PAPER_DISCOVERY_OPPORTUNITIES_TOTAL.inc({ scope: 'paper_discovery' });

    return { discovered, errors };
  }

  /**
   * Get list of tokens with paper-only status.
   * For Phase 3 slice, returns simulated data.
   * In production, this would query from a token status service.
   */
  private async getPaperOnlyTokens(): Promise<
    Array<{ tokenKey: string; tokenName: string }>
  > {
    // Phase 3 slice: Simulated paper-only tokens
    // In production: fetch from token/status service
    return [
      { tokenKey: 'BTC', tokenName: 'Bitcoin' },
      { tokenKey: 'ETH', tokenName: 'Ethereum' },
      { tokenKey: 'SOL', tokenName: 'Solana' },
      { tokenKey: 'AVAX', tokenName: 'Avalanche' },
      { tokenKey: 'MATIC', tokenName: 'Polygon' },
      { tokenKey: 'ARB', tokenName: 'Arbitrum' },
      { tokenKey: 'OP', tokenName: 'Optimism' },
    ];
  }

  /**
   * Find existing paper promotion candidate for a token.
   */
  private async findExistingPaperCandidate(
    tokenKey: string,
  ): Promise<PaperPromotionCandidateEntity | null> {
    return this.paperCandidateRepository.findOne({
      where: { tokenKey },
      order: { entityVersion: 'DESC' },
    });
  }

  /**
   * Create a new paper promotion candidate.
   */
  private async createPaperCandidate(
    token: { tokenKey: string; tokenName: string },
  ): Promise<PaperPromotionCandidateEntity> {
    const id = uuidv4();
    const now = new Date();

    // Calculate drift threshold from config
    const driftThreshold = await this.getDriftThreshold();

    const entity = this.paperCandidateRepository.create({
      id,
      tokenKey: token.tokenKey,
      tokenName: token.tokenName,
      status: 'pending',
      driftBps: 0,
      driftThresholdBps: driftThreshold,
      createdAt: now,
      updatedAt: now,
      entityVersion: 1,
    });

    return this.paperCandidateRepository.save(entity);
  }

  /**
   * Get drift threshold from configuration (fallback to 50 bps).
   */
  private async getDriftThreshold(): Promise<number> {
    try {
      const config = await this.configRepository.findOne({
        where: { configKey: 'paper.drift.threshold.bps', is_active: true },
      });

      if (config && config.configValue) {
        return parseInt(config.configValue, 10);
      }
    } catch (error) {
      this.logger.warn('Failed to read drift threshold config, using fallback:', error);
    }

    // Default threshold from Phase 3 spec
    return 50;
  }

  /**
   * Create paper-only opportunity for a token.
   */
  private async createPaperOpportunity(
    token: { tokenKey: string; tokenName: string },
    candidate: PaperPromotionCandidateEntity,
  ): Promise<void> {
    // Check if opportunity already exists for this token/candidate pair
    const existingOpportunity = await this.opportunityRepository.findOne({
      where: { configKey: `paper.discovery.${token.tokenKey}` },
    });

    if (existingOpportunity) {
      this.logger.debug(
        `Paper opportunity already exists for token ${token.tokenKey}`,
      );
      return;
    }

    // Create opportunity entity with paper-only attributes
    const id = uuidv4();
    const now = new Date();

    const opportunity = this.opportunityRepository.create({
      id,
      configKey: `paper.discovery.${token.tokenKey}`,
      configValue: token.tokenKey, // Store token key as value
      state: 'enriched',
      sourceType: 'paper_discovery',
      riskDecisionId: null, // Will be populated by risk evaluation
      entityVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await this.opportunityRepository.save(opportunity);
    this.logger.log(`Created paper opportunity for token ${token.tokenKey}`);
  }
}
