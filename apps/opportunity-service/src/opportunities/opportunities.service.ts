import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import type { CreateOpportunityDto } from './dto/create-opportunity.dto';

@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectRepository(ArbitrageOpportunityEntity)
    private readonly repo: Repository<ArbitrageOpportunityEntity>,
  ) {}

  async create(dto: CreateOpportunityDto): Promise<ArbitrageOpportunityEntity> {
    const row = this.repo.create({
      correlationId: dto.correlationId ?? null,
      state: 'detected',
      payload: dto.payload ?? {},
      entityVersion: 1,
    });
    return this.repo.save(row);
  }

  async list(): Promise<ArbitrageOpportunityEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  async getById(id: string): Promise<ArbitrageOpportunityEntity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
