import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AlertmanagerIncidentEntity } from '@arbibot/persistence';

import { AlertIncidentsService } from './alert-incidents.service';
import { AlertIncidentNotFoundError } from './alert-incidents.errors';
import type { AlertmanagerAlertDto } from './dto/alertmanager-webhook.dto';

type EntityStub = Partial<AlertmanagerIncidentEntity> &
  Record<string, unknown>;

function makeEntity(over: EntityStub = {}): AlertmanagerIncidentEntity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    alertName: 'TestAlert',
    severity: 'warning',
    status: 'firing',
    fingerprint: 'fp-1',
    entityVersion: 1,
    summary: null,
    description: null,
    payload: {},
    startsAt: null,
    endsAt: null,
    lastFiredAt: new Date('2026-06-15T10:00:00Z'),
    createdAt: new Date('2026-06-15T09:00:00Z'),
    updatedAt: new Date('2026-06-15T09:00:00Z'),
    resolvedAt: null,
    resolvedBy: null,
    ...over,
  };
}

function makeAlert(
  over: Partial<AlertmanagerAlertDto> = {},
): AlertmanagerAlertDto {
  return {
    status: 'firing',
    labels: { alertname: 'TestAlert', severity: 'warning' },
    annotations: { summary: 'something is wrong' },
    startsAt: '2026-06-15T10:00:00Z',
    endsAt: '0001-01-01T00:00:00Z',
    generatorURL: 'http://prom/123',
    fingerprint: 'fp-1',
    value: '0.5',
    ...over,
  };
}

type EntityManagerLike = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

describe('AlertIncidentsService', () => {
  let service: AlertIncidentsService;
  let repo: jest.Mocked<Pick<Repository<AlertmanagerIncidentEntity>, 'find'>>;
  const repoToken = getRepositoryToken(AlertmanagerIncidentEntity);
  let em: EntityManagerLike;
  let createdRows: Partial<AlertmanagerIncidentEntity>[];
  let savedRows: Partial<AlertmanagerIncidentEntity>[];

  beforeEach(async () => {
    createdRows = [];
    savedRows = [];
    em = {
      findOne: jest.fn(),
      create: jest.fn((_, values) => {
        const row = { ...values };
        createdRows.push(row);
        return row;
      }),
      save: jest.fn((row) => {
        savedRows.push(row);
        return Promise.resolve(row);
      }),
    };

    const dataSource = {
      transaction: jest.fn(
        async (cb: (entityManager: EntityManagerLike) => Promise<unknown>) =>
          cb(em),
      ),
    };

    repo = {
      find: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertIncidentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: repoToken, useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(AlertIncidentsService);
  });

  it('inserts a new incident from a firing alert', async () => {
    const result = await service.ingestAlert(makeAlert());

    expect(result.inserted).toBe(true);
    expect(result.fingerprint).toBe('fp-1');
    expect(em.create).toHaveBeenCalledTimes(1);
    expect(em.save).toHaveBeenCalledTimes(1);
    const created = createdRows[0]!;
    expect(created.status).toBe('firing');
    expect(created.alertName).toBe('TestAlert');
    expect(created.severity).toBe('warning');
    expect(created.summary).toBe('something is wrong');
  });

  it('normalizes severity variants (error -> critical)', async () => {
    await service.ingestAlert(
      makeAlert({ labels: { alertname: 'X', severity: 'error' } }),
    );
    const created = createdRows[0]!;
    expect(created.severity).toBe('critical');
  });

  it('marks resolved webhook as resolved_external when existing row was firing', async () => {
    em.findOne.mockResolvedValueOnce(makeEntity({ status: 'firing' }));

    await service.ingestAlert(makeAlert({ status: 'resolved' }));

    const saved = savedRows[0]!;
    expect(saved.status).toBe('resolved_external');
    expect(saved.resolvedAt).not.toBeNull();
  });

  it('re-opens resolved_external when Alertmanager fires again', async () => {
    em.findOne.mockResolvedValueOnce(
      makeEntity({ status: 'resolved_external', resolvedBy: 'op-1' }),
    );

    await service.ingestAlert(makeAlert({ status: 'firing' }));

    const saved = savedRows[0]!;
    expect(saved.status).toBe('firing');
    expect(saved.resolvedAt).toBeNull();
    expect(saved.resolvedBy).toBeNull();
  });

  it('keeps operator investigating state untouched on resolved webhook', async () => {
    em.findOne.mockResolvedValueOnce(makeEntity({ status: 'investigating' }));

    await service.ingestAlert(makeAlert({ status: 'resolved' }));

    expect(savedRows).toHaveLength(0);
  });

  it('list() delegates to repo.find with order and limit', async () => {
    repo.find.mockResolvedValue([makeEntity()]);
    const out = await service.list('firing');
    expect(repo.find).toHaveBeenCalledWith({
      where: { status: 'firing' },
      order: { lastFiredAt: 'DESC' },
      take: 200,
    });
    expect(out).toHaveLength(1);
  });

  it('list() without status omits the where filter', async () => {
    repo.find.mockResolvedValue([]);
    await service.list(undefined);
    expect(repo.find).toHaveBeenCalledWith({
      where: {},
      order: { lastFiredAt: 'DESC' },
      take: 200,
    });
  });

  it('ingestAlert returns inserted=false for a resolved webhook with no existing incident', async () => {
    // No existing row -> resolved webhook for unknown fingerprint is ignored.
    em.findOne.mockResolvedValueOnce(null);

    const result = await service.ingestAlert(makeAlert({ status: 'resolved' }));

    expect(result).toEqual({ inserted: false, fingerprint: 'fp-1', id: null });
    expect(savedRows).toHaveLength(0);
  });

  describe('setStatus', () => {
    it('resolves an incident: sets resolvedAt/resolvedBy, fills endsAt if null, bumps version', async () => {
      const existing = makeEntity({ status: 'investigating', entityVersion: 2, endsAt: null });
      em.findOne.mockResolvedValueOnce(existing);

      const saved = await service.setStatus({
        id: existing.id,
        status: 'resolved',
        expectedEntityVersion: 2,
        resolvedBy: 'op-1',
      });

      expect(saved.status).toBe('resolved');
      expect(saved.entityVersion).toBe(3);
      expect(saved.resolvedBy).toBe('op-1');
      expect(saved.resolvedAt).toBeInstanceOf(Date);
      // endsAt was null -> filled with now.
      expect(saved.endsAt).toBeInstanceOf(Date);
    });

    it('keeps existing endsAt when moving to resolved (does not overwrite)', async () => {
      const existingEnds = new Date('2026-06-15T11:00:00Z');
      const existing = makeEntity({ status: 'firing', entityVersion: 1, endsAt: existingEnds });
      em.findOne.mockResolvedValueOnce(existing);

      const saved = await service.setStatus({
        id: existing.id,
        status: 'resolved',
        expectedEntityVersion: 1,
        resolvedBy: null,
      });

      expect(saved.endsAt).toBe(existingEnds);
      expect(saved.resolvedBy).toBeNull();
    });

    it('moving to investigating clears stale resolution metadata', async () => {
      const existing = makeEntity({
        status: 'resolved',
        entityVersion: 3,
        resolvedAt: new Date(),
        resolvedBy: 'op-old',
      });
      em.findOne.mockResolvedValueOnce(existing);

      const saved = await service.setStatus({
        id: existing.id,
        status: 'investigating',
        expectedEntityVersion: 3,
      });

      expect(saved.status).toBe('investigating');
      expect(saved.resolvedAt).toBeNull();
      expect(saved.resolvedBy).toBeNull();
    });

    it('throws AlertIncidentNotFoundError when the id does not exist', async () => {
      em.findOne.mockResolvedValueOnce(null);

      await expect(
        service.setStatus({
          id: 'missing',
          status: 'resolved',
          expectedEntityVersion: 1,
        }),
      ).rejects.toThrow(AlertIncidentNotFoundError);
    });

    it('throws AlertIncidentVersionMismatchError on stale expectedEntityVersion', async () => {
      em.findOne.mockResolvedValueOnce(makeEntity({ entityVersion: 5 }));

      await expect(
        service.setStatus({
          id: '11111111-1111-1111-1111-111111111111',
          status: 'resolved',
          expectedEntityVersion: 1,
        }),
      ).rejects.toThrow(/version mismatch: expected 1, actual 5/);
    });
  });
});
