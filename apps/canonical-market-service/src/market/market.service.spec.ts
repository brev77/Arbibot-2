import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import type {
  CanonicalInstrumentEntity,
  CanonicalRouteEntity,
  VenueRefEntity,
} from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import type { ResolveInstrumentDto } from './dto/resolve-instrument.dto';
import type { ResolveRouteDto } from './dto/resolve-route.dto';
import type { RedisConnection } from '../redis/redis-connection';
import { MarketService } from './market.service';

describe('MarketService', () => {
  let service: MarketService;
  let venueRepo: jest.Mocked<Pick<Repository<VenueRefEntity>, 'findOne'>>;
  let instrumentRepo: jest.Mocked<
    Pick<Repository<CanonicalInstrumentEntity>, 'findOne'>
  >;
  let routeRepo: jest.Mocked<
    Pick<Repository<CanonicalRouteEntity>, 'findOne' | 'find'>
  >;
  let redisGet: jest.Mock;
  let redisSetEx: jest.Mock;
  let redisConnection: RedisConnection;

  const venue: VenueRefEntity = {
    id: 'v1',
    venueCode: 'BINANCE',
    displayName: 'Binance',
    entityVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const inst: CanonicalInstrumentEntity = {
    id: 'i1',
    venueRefId: venue.id,
    venueRef: venue,
    venueSymbol: 'BTCUSDT',
    canonicalKey: 'BINANCE:BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    attributes: {},
    entityVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const route: CanonicalRouteEntity = {
    id: 'r1',
    routeKey: 'BINANCE:BTC-USDT->BINANCE:ETH-USDT',
    sourceInstrumentId: 'i1',
    sourceInstrument: inst,
    targetInstrumentId: 'i2',
    targetInstrument: inst,
    hops: [{ leg: 0 }],
    entityVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    venueRepo = { findOne: jest.fn() };
    instrumentRepo = { findOne: jest.fn() };
    routeRepo = { findOne: jest.fn(), find: jest.fn() };
    redisGet = jest.fn().mockResolvedValue(null);
    redisSetEx = jest.fn().mockResolvedValue(undefined);
    redisConnection = {
      get client() {
        return { get: redisGet, setEx: redisSetEx };
      },
    } as unknown as RedisConnection;
    // Casts required by TS (partial mock -> full Repository), but ESLint's
    // type-info disagrees; suppress the false positive.
    service = new MarketService(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      venueRepo as unknown as Repository<VenueRefEntity>,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      instrumentRepo as unknown as Repository<CanonicalInstrumentEntity>,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      routeRepo as unknown as Repository<CanonicalRouteEntity>,
      redisConnection,
    );
  });

  describe('resolveInstrument', () => {
    it('resolves by canonicalKey', async () => {
      instrumentRepo.findOne.mockResolvedValue(inst);
      const dto: ResolveInstrumentDto = { canonicalKey: 'BINANCE:BTC-USDT' };
      const out = await service.resolveInstrument(dto);
      expect(out.id).toBe('i1');
      expect(out.canonicalKey).toBe('BINANCE:BTC-USDT');
      expect(instrumentRepo.findOne).toHaveBeenCalledWith({
        where: { canonicalKey: 'BINANCE:BTC-USDT' },
        relations: { venueRef: true },
      });
    });

    it('resolves by venue + symbol', async () => {
      venueRepo.findOne.mockResolvedValue(venue);
      instrumentRepo.findOne.mockResolvedValue(inst);
      const dto: ResolveInstrumentDto = {
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
      };
      const out = await service.resolveInstrument(dto);
      expect(out.venueCode).toBe('BINANCE');
      expect(venueRepo.findOne).toHaveBeenCalledWith({
        where: { venueCode: 'BINANCE' },
      });
    });

    it('throws when venue unknown', async () => {
      venueRepo.findOne.mockResolvedValue(null);
      await expect(
        service.resolveInstrument({
          venueCode: 'X',
          venueSymbol: 'Y',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws on ambiguous input', async () => {
      await expect(
        service.resolveInstrument({
          canonicalKey: 'K',
          venueCode: 'V',
          venueSymbol: 'S',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns cached instrument without hitting DB', async () => {
      const cached = {
        id: 'i1',
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        canonicalKey: 'BINANCE:BTC-USDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        attributes: {},
        entityVersion: 1,
        createdAtIso: '2026-01-01T00:00:00.000Z',
        updatedAtIso: '2026-01-01T00:00:00.000Z',
      };
      redisGet.mockResolvedValueOnce(JSON.stringify(cached));
      const dto: ResolveInstrumentDto = { canonicalKey: 'BINANCE:BTC-USDT' };
      const out = await service.resolveInstrument(dto);
      expect(out).toEqual(cached);
      expect(instrumentRepo.findOne).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis get throws', async () => {
      redisGet.mockRejectedValueOnce(new Error('redis down'));
      instrumentRepo.findOne.mockResolvedValue(inst);
      const dto: ResolveInstrumentDto = { canonicalKey: 'BINANCE:BTC-USDT' };
      const out = await service.resolveInstrument(dto);
      expect(out.id).toBe('i1');
      expect(instrumentRepo.findOne).toHaveBeenCalled();
    });

    it('throws "do not mix" when canonicalKey is combined with venueCode only', async () => {
      await expect(
        service.resolveInstrument({ canonicalKey: 'K', venueCode: 'V' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the instrument row is not found', async () => {
      instrumentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.resolveInstrument({ canonicalKey: 'MISSING' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns empty venueCode when the instrument has no venueRef relation loaded', async () => {
      // Covers the `row.venueRef?.venueCode ?? ''` branch in toInstrumentView.
      // venueRef is required on the entity type but may be unset when relations
      // are not loaded; emulate that via Partial + cast.
      const instWithoutVenue = { ...inst, venueRef: undefined } as unknown as CanonicalInstrumentEntity;
      instrumentRepo.findOne.mockResolvedValue(instWithoutVenue);

      const out = await service.resolveInstrument({ canonicalKey: 'BINANCE:BTC-USDT' });

      expect(out.venueCode).toBe('');
      expect(out.id).toBe('i1');
    });

    it('returns null (DB fallback) when cached instrument JSON is not an object', async () => {
      redisGet.mockResolvedValueOnce('"a-string"');
      instrumentRepo.findOne.mockResolvedValue(inst);

      const out = await service.resolveInstrument({ canonicalKey: 'BINANCE:BTC-USDT' });

      expect(out.id).toBe('i1');
      expect(instrumentRepo.findOne).toHaveBeenCalled();
    });

    it('returns null (DB fallback) when cached instrument JSON has wrong field types', async () => {
      // id is a number instead of string -> shape mismatch -> parse returns null.
      redisGet.mockResolvedValueOnce(
        JSON.stringify({ id: 42, venueCode: 'X', venueSymbol: 'Y', canonicalKey: 'K', baseAsset: 'B', quoteAsset: 'Q', attributes: {}, entityVersion: 1, createdAtIso: 'a', updatedAtIso: 'b' }),
      );
      instrumentRepo.findOne.mockResolvedValue(inst);

      const out = await service.resolveInstrument({ canonicalKey: 'BINANCE:BTC-USDT' });

      expect(out.id).toBe('i1');
      expect(instrumentRepo.findOne).toHaveBeenCalled();
    });

    it('returns null (DB fallback) when cached instrument JSON is unparseable', async () => {
      redisGet.mockResolvedValueOnce('{not-json');
      instrumentRepo.findOne.mockResolvedValue(inst);

      const out = await service.resolveInstrument({ canonicalKey: 'BINANCE:BTC-USDT' });

      expect(out.id).toBe('i1');
      expect(instrumentRepo.findOne).toHaveBeenCalled();
    });

    it('returns null (DB fallback) when cached instrument attributes is an array', async () => {
      redisGet.mockResolvedValueOnce(
        JSON.stringify({ id: 'i', venueCode: 'v', venueSymbol: 's', canonicalKey: 'k', baseAsset: 'b', quoteAsset: 'q', attributes: [], entityVersion: 1, createdAtIso: 'a', updatedAtIso: 'b' }),
      );
      instrumentRepo.findOne.mockResolvedValue(inst);

      const out = await service.resolveInstrument({ canonicalKey: 'BINANCE:BTC-USDT' });

      expect(out.id).toBe('i1');
    });
  });

  describe('with Redis disabled (client null)', () => {
    /** Build a service bound to a no-op Redis (client null) — cache-skipped paths. */
    const mkServiceNoCache = (): MarketService => {
      const noRedis = { client: null } as unknown as RedisConnection;
      // Casts required by TS (partial mock -> full Repository); ESLint flags
      // them as redundant (type-resolution desync). eslint-disable mirrors the
      // beforeEach construction-site casts.
      return new MarketService(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        venueRepo as unknown as Repository<VenueRefEntity>,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        instrumentRepo as unknown as Repository<CanonicalInstrumentEntity>,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        routeRepo as unknown as Repository<CanonicalRouteEntity>,
        noRedis,
      );
    };

    it('resolveInstrument skips cache entirely and queries the DB', async () => {
      const svcNoCache = mkServiceNoCache();
      instrumentRepo.findOne.mockResolvedValue(inst);

      const out = await svcNoCache.resolveInstrument({ canonicalKey: 'BINANCE:BTC-USDT' });

      expect(out.id).toBe('i1');
      expect(instrumentRepo.findOne).toHaveBeenCalled();
      // No cache read attempted.
      expect(redisGet).not.toHaveBeenCalled();
    });

    it('resolveRoute skips cache entirely and queries the DB', async () => {
      const svcNoCache = mkServiceNoCache();
      routeRepo.findOne.mockResolvedValue(route);

      const out = await svcNoCache.resolveRoute({ routeKey: 'k' });

      expect(out.id).toBe('r1');
      expect(redisGet).not.toHaveBeenCalled();
    });
  });

  describe('resolveRoute', () => {
    it('resolves by routeKey', async () => {
      routeRepo.findOne.mockResolvedValue(route);
      const dto: ResolveRouteDto = {
        routeKey: 'BINANCE:BTC-USDT->BINANCE:ETH-USDT',
      };
      const out = await service.resolveRoute(dto);
      expect(out.id).toBe('r1');
      expect(routeRepo.findOne).toHaveBeenCalledWith({
        where: { routeKey: 'BINANCE:BTC-USDT->BINANCE:ETH-USDT' },
      });
    });

    it('resolves by endpoint ids', async () => {
      routeRepo.find.mockResolvedValue([route]);
      const out = await service.resolveRoute({
        sourceInstrumentId: 'i1',
        targetInstrumentId: 'i2',
      });
      expect(out.sourceInstrumentId).toBe('i1');
      expect(routeRepo.find).toHaveBeenCalledWith({
        where: { sourceInstrumentId: 'i1', targetInstrumentId: 'i2' },
        take: 2,
      });
    });

    it('throws when multiple routes match instrument pair', async () => {
      routeRepo.find.mockResolvedValue([
        route,
        { ...route, id: 'r2', routeKey: 'other' },
      ]);
      await expect(
        service.resolveRoute({
          sourceInstrumentId: 'i1',
          targetInstrumentId: 'i2',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws on mixed keys', async () => {
      await expect(
        service.resolveRoute({
          routeKey: 'k',
          sourceInstrumentId: 'i1',
          targetInstrumentId: 'i2',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws "do not mix" when routeKey is combined with sourceInstrumentId only', async () => {
      await expect(
        service.resolveRoute({
          routeKey: 'k',
          sourceInstrumentId: 'i1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the route row is not found (by routeKey)', async () => {
      routeRepo.findOne.mockResolvedValue(null);
      await expect(service.resolveRoute({ routeKey: 'MISSING' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when no route matches the instrument pair', async () => {
      routeRepo.find.mockResolvedValue([]);
      await expect(
        service.resolveRoute({
          sourceInstrumentId: 'i1',
          targetInstrumentId: 'iX',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('falls back to DB when Redis route get throws', async () => {
      redisGet.mockRejectedValueOnce(new Error('redis down'));
      routeRepo.findOne.mockResolvedValue(route);
      const out = await service.resolveRoute({ routeKey: 'k' });
      expect(out.id).toBe('r1');
      expect(routeRepo.findOne).toHaveBeenCalled();
    });

    it('returns null (DB fallback) when cached route JSON is not an object', async () => {
      redisGet.mockResolvedValueOnce('42');
      routeRepo.findOne.mockResolvedValue(route);
      const out = await service.resolveRoute({ routeKey: 'k' });
      expect(out.id).toBe('r1');
      expect(routeRepo.findOne).toHaveBeenCalled();
    });

    it('returns null (DB fallback) when cached route JSON has wrong field types', async () => {
      redisGet.mockResolvedValueOnce(
        JSON.stringify({ id: 'r', routeKey: 1, sourceInstrumentId: 's', targetInstrumentId: 't', hops: [], entityVersion: 1, createdAtIso: 'a', updatedAtIso: 'b' }),
      );
      routeRepo.findOne.mockResolvedValue(route);
      const out = await service.resolveRoute({ routeKey: 'k' });
      expect(out.id).toBe('r1');
    });

    it('returns null (DB fallback) when cached route hops is not an array', async () => {
      redisGet.mockResolvedValueOnce(
        JSON.stringify({ id: 'r', routeKey: 'k', sourceInstrumentId: 's', targetInstrumentId: 't', hops: 'not-array', entityVersion: 1, createdAtIso: 'a', updatedAtIso: 'b' }),
      );
      routeRepo.findOne.mockResolvedValue(route);
      const out = await service.resolveRoute({ routeKey: 'k' });
      expect(out.id).toBe('r1');
    });

    it('returns null (DB fallback) when cached route JSON is unparseable', async () => {
      redisGet.mockResolvedValueOnce('}{');
      routeRepo.findOne.mockResolvedValue(route);
      const out = await service.resolveRoute({ routeKey: 'k' });
      expect(out.id).toBe('r1');
    });

    it('returns cached route without hitting DB', async () => {
      const cached = {
        id: 'r1',
        routeKey: 'BINANCE:BTC-USDT->BINANCE:ETH-USDT',
        sourceInstrumentId: 'i1',
        targetInstrumentId: 'i2',
        hops: [{ leg: 0 }],
        entityVersion: 1,
        createdAtIso: '2026-01-01T00:00:00.000Z',
        updatedAtIso: '2026-01-01T00:00:00.000Z',
      };
      redisGet.mockResolvedValueOnce(JSON.stringify(cached));
      const dto: ResolveRouteDto = {
        routeKey: 'BINANCE:BTC-USDT->BINANCE:ETH-USDT',
      };
      const out = await service.resolveRoute(dto);
      expect(out).toEqual(cached);
      expect(routeRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
