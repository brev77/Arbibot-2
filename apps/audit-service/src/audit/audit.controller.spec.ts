 
import type { AuditLogEntity } from '@arbibot/persistence';
import type { FastifyReply } from 'fastify';

import type { AppendAuditDto } from './dto/append-audit.dto';
import { AuditController } from './audit.controller';
import type { AuditService } from './audit.service';

/**
 * AuditController spec.
 *
 * Pattern: direct instantiation with a stub AuditService. The controller is a
 * thin adapter — exercises DTO→service delegation, X-Idempotent-Replayed
 * header on replay, ISO-date mapping, default limit fallback.
 */
describe('AuditController', () => {
  let service: { append: jest.Mock; recent: jest.Mock };
  let controller: AuditController;
  let reply: {
    status: jest.Mock;
    header: jest.Mock;
  };

  function mkEntry(
    over: Partial<AuditLogEntity> = {},
  ): AuditLogEntity {
    return {
      id: 'entry-1',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
      actor: 'op-1',
      action: 'AUDIT_TEST',
      resourceType: 'resource',
      resourceId: 'r-1',
      payload: { foo: 'bar' },
      createdAt: new Date('2026-07-17T12:00:00Z'),
      ...over,
    };
  }

  beforeEach(() => {
    service = {
      append: jest.fn(),
      recent: jest.fn().mockResolvedValue([]),
    };
    reply = {
      status: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
    };
    controller = new AuditController(service as unknown as AuditService);
  });

  describe('append', () => {
    it('returns 201 CREATED + view when first-time append (no replay)', async () => {
      service.append.mockResolvedValue({
        replay: false,
        entity: mkEntry(),
      });

      const body: AppendAuditDto = {
        actor: 'op-1',
        action: 'AUDIT_TEST',
      };

      const result = await controller.append(
        body,
        reply as unknown as FastifyReply,
      );

      expect(service.append).toHaveBeenCalledWith(body);
      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.header).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 'entry-1',
        correlationId: 'corr-1',
        actor: 'op-1',
        action: 'AUDIT_TEST',
        createdAt: '2026-07-17T12:00:00.000Z',
      });
    });

    it('returns 200 OK + X-Idempotent-Replayed header when replay', async () => {
      service.append.mockResolvedValue({
        replay: true,
        entity: mkEntry(),
      });

      const result = await controller.append(
        { actor: 'op-1', action: 'AUDIT_TEST' },
        reply as unknown as FastifyReply,
      );

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.header).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
      expect(result.id).toBe('entry-1');
    });
  });

  describe('list', () => {
    it('uses provided limit when numeric', async () => {
      await controller.list('25');
      expect(service.recent).toHaveBeenCalledWith(25);
    });

    it('falls back to default limit 50 when query param is undefined', async () => {
      await controller.list(undefined);
      expect(service.recent).toHaveBeenCalledWith(50);
    });

    it('falls back to default limit 50 when query param is non-numeric', async () => {
      await controller.list('abc');
      expect(service.recent).toHaveBeenCalledWith(50);
    });

    it('maps entries to ISO-date DTOs', async () => {
      service.recent.mockResolvedValue([mkEntry()]);

      const result = await controller.list('10');

      expect(result).toEqual({
        items: [
          {
            id: 'entry-1',
            correlationId: 'corr-1',
            actor: 'op-1',
            action: 'AUDIT_TEST',
            resourceType: 'resource',
            resourceId: 'r-1',
            payload: { foo: 'bar' },
            createdAt: '2026-07-17T12:00:00.000Z',
          },
        ],
      });
    });

    it('returns empty items array when service returns no entries', async () => {
      service.recent.mockResolvedValue([]);
      const result = await controller.list();
      expect(result).toEqual({ items: [] });
    });
  });
});
