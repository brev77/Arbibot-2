 
import { HttpStatus, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import {
  ConfigScopeType,
  type CreateConfigurationDto,
} from '../dto/create-configuration.dto';
import type {
  ConfigurationResponseDto,
  ConfigurationHistoryItemDto,
} from '../dto/configuration-response.dto';
import type { RollbackConfigurationDto } from '../dto/rollback-configuration.dto';
import type { PromoteConfigurationDto } from '../dto/promote-configuration.dto';
import type { UpdateConfigurationStatusDto } from '../dto/update-configuration-status.dto';

import { ConfigController } from './config.controller';
import type { ConfigurationsService } from './configurations.service';

/**
 * ConfigController spec — thin adapter over ConfigurationsService.
 *
 * Pattern: direct instantiation with a stub service. Exercises:
 *   - GET endpoints return service result verbatim
 *   - getEffective/getByKey throw NotFoundException on null
 *   - Mutating endpoints require operatorId (400 + early return)
 *   - History defaults scopeType to GLOBAL when omitted
 *   - getByKey forwards scopeValue || null
 */
describe('ConfigController', () => {
  let service: {
    getAll: jest.Mock;
    getEffective: jest.Mock;
    getByKey: jest.Mock;
    getHistory: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    rollback: jest.Mock;
    promote: jest.Mock;
    updateStatus: jest.Mock;
  };
  let controller: ConfigController;
  let reply: { status: jest.Mock; send: jest.Mock };

  function mkReply() {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  }

  function mkRow(
    over: Partial<ConfigurationResponseDto> = {},
  ): ConfigurationResponseDto {
    return {
      id: '1',
      configKey: 'intake.throttling',
      configValue: '{}',
      isSensitive: false,
      status: 'active',
      scopeType: 'global',
      scopeValue: null,
      entityVersion: 1,
      operatorId: 'op-1',
      approveReason: null,
      createdAt: new Date('2026-07-17T12:00:00Z').toISOString(),
      updatedAt: new Date('2026-07-17T12:00:00Z').toISOString(),
      ...over,
    } as unknown as ConfigurationResponseDto;
  }

  beforeEach(() => {
    service = {
      getAll: jest.fn().mockResolvedValue([mkRow()]),
      getEffective: jest.fn().mockResolvedValue(mkRow()),
      getByKey: jest.fn().mockResolvedValue(mkRow()),
      getHistory: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(mkRow()),
      update: jest.fn().mockResolvedValue(mkRow()),
      rollback: jest.fn().mockResolvedValue({}),
      promote: jest.fn().mockResolvedValue(mkRow()),
      updateStatus: jest.fn().mockResolvedValue(mkRow()),
    };
    reply = mkReply();
    controller = new ConfigController(
      service as unknown as ConfigurationsService,
    );
  });

  describe('GET endpoints', () => {
    it('getAll forwards the query DTO and returns rows', async () => {
      const query = { scopeType: 'environment' as ConfigScopeType };
      const result = await controller.getAll(query);
      expect(service.getAll).toHaveBeenCalledWith(query);
      expect(result).toHaveLength(1);
    });

    it('getEffective returns config when found', async () => {
      const result = await controller.getEffective('intake.throttling', 'staging');
      expect(service.getEffective).toHaveBeenCalledWith(
        'intake.throttling',
        'staging',
        undefined,
      );
      expect(result).toBeDefined();
    });

    it('getEffective throws NotFoundException when config is null', async () => {
      service.getEffective.mockResolvedValueOnce(null);
      await expect(
        controller.getEffective('missing.key'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getByKey returns config when found', async () => {
      const result = await controller.getByKey(
        'intake.throttling',
        ConfigScopeType.TENANT,
        't-1',
      );
      expect(service.getByKey).toHaveBeenCalledWith(
        'intake.throttling',
        ConfigScopeType.TENANT,
        't-1',
      );
      expect(result).toBeDefined();
    });

    it('getByKey forwards null scopeValue when omitted', async () => {
      await controller.getByKey('intake.throttling', ConfigScopeType.GLOBAL);
      expect(service.getByKey).toHaveBeenCalledWith(
        'intake.throttling',
        ConfigScopeType.GLOBAL,
        null,
      );
    });

    it('getByKey throws NotFoundException when config is null', async () => {
      service.getByKey.mockResolvedValueOnce(null);
      await expect(
        controller.getByKey('missing.key'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getHistory forwards with default GLOBAL when scopeType omitted', async () => {
      await controller.getHistory('intake.throttling');
      expect(service.getHistory).toHaveBeenCalledWith(
        'intake.throttling',
        'global',
        null,
      );
    });

    it('getHistory forwards explicit scopeType and scopeValue', async () => {
      await controller.getHistory(
        'intake.throttling',
        ConfigScopeType.TENANT,
        't-1',
      );
      expect(service.getHistory).toHaveBeenCalledWith(
        'intake.throttling',
        ConfigScopeType.TENANT,
        't-1',
      );
    });

    it('getHistory returns rows verbatim', async () => {
      const rows = [
        { id: '1', entityVersion: 1 },
      ] as unknown as ConfigurationHistoryItemDto[];
      service.getHistory.mockResolvedValueOnce(rows);
      const result = await controller.getHistory('intake.throttling');
      expect(result).toBe(rows);
    });
  });

  describe('mutating endpoints — operatorId validation', () => {
    it('create returns 400 when operatorId is empty', async () => {
      const dto = { configKey: 'k', configValue: '{}' } as CreateConfigurationDto;
      await controller.create(dto, '', reply as unknown as FastifyReply);
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(reply.send).toHaveBeenCalledWith({ error: 'operatorId is required' });
      expect(service.create).not.toHaveBeenCalled();
    });

    it('create delegates when operatorId is present', async () => {
      const dto = { configKey: 'k', configValue: '{}' } as CreateConfigurationDto;
      await controller.create(dto, 'op-1', reply as unknown as FastifyReply);
      expect(service.create).toHaveBeenCalledWith(dto, 'op-1');
    });

    it('update returns 400 when operatorId missing', async () => {
      const dto = { configValue: '{}' } as never;
      await controller.update(
        'k',
        dto,
        '',
        reply as unknown as FastifyReply,
      );
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(service.update).not.toHaveBeenCalled();
    });

    it('update delegates when operatorId present', async () => {
      const dto = { configValue: '{}' } as never;
      await controller.update(
        'k',
        dto,
        'op-1',
        reply as unknown as FastifyReply,
      );
      expect(service.update).toHaveBeenCalledWith('k', dto, 'op-1');
    });

    it('rollback returns 400 when operatorId missing', async () => {
      const dto = { toVersion: 1 } as RollbackConfigurationDto;
      await controller.rollback(
        'k',
        dto,
        '',
        reply as unknown as FastifyReply,
      );
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(service.rollback).not.toHaveBeenCalled();
    });

    it('rollback delegates when operatorId present', async () => {
      const dto = { toVersion: 1 } as RollbackConfigurationDto;
      await controller.rollback(
        'k',
        dto,
        'op-1',
        reply as unknown as FastifyReply,
      );
      expect(service.rollback).toHaveBeenCalledWith('k', dto, 'op-1');
    });

    it('promote returns 400 when operatorId missing', async () => {
      const dto = {
        fromScopeType: 'global',
        toScopeType: 'tenant',
      } as PromoteConfigurationDto;
      await controller.promote(
        'k',
        dto,
        '',
        reply as unknown as FastifyReply,
      );
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(service.promote).not.toHaveBeenCalled();
    });

    it('promote delegates when operatorId present', async () => {
      const dto = {
        fromScopeType: 'global',
        toScopeType: 'tenant',
      } as PromoteConfigurationDto;
      await controller.promote(
        'k',
        dto,
        'op-1',
        reply as unknown as FastifyReply,
      );
      expect(service.promote).toHaveBeenCalledWith('k', dto, 'op-1');
    });

    it('updateStatus returns 400 when operatorId missing', async () => {
      const dto = { status: 'active' } as UpdateConfigurationStatusDto;
      await controller.updateStatus(
        'k',
        dto,
        '',
        reply as unknown as FastifyReply,
      );
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(service.updateStatus).not.toHaveBeenCalled();
    });

    it('updateStatus delegates when operatorId present', async () => {
      const dto = { status: 'active' } as UpdateConfigurationStatusDto;
      await controller.updateStatus(
        'k',
        dto,
        'op-1',
        reply as unknown as FastifyReply,
      );
      expect(service.updateStatus).toHaveBeenCalledWith('k', dto, 'op-1');
    });
  });
});
