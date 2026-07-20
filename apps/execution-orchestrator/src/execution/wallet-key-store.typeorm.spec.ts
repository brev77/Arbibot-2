import type { Repository } from 'typeorm';
import type { WalletKeyEntity } from '@arbibot/persistence';
import type { EncryptedKey, WalletKeyRecord } from '@arbibot/nest-platform';

import { TypeOrmWalletKeyStore } from './wallet-key-store.typeorm';

/**
 * TypeOrmWalletKeyStore spec (D4-B-4-KEYS).
 *
 * Pattern A: direct instantiation with a lightweight Repository mock.
 * Every method is a thin wrapper around find/save/update — full branch
 * coverage exercisable via repo stubs.
 */
describe('TypeOrmWalletKeyStore', () => {
  let store: TypeOrmWalletKeyStore;
  let repo: {
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };

  const mkRow = (
    over: Partial<WalletKeyEntity> = {},
  ): WalletKeyEntity =>
    ({
      keyId: 'k-1',
      address: '0xabc',
      chainId: 1,
      isActive: true,
      encryptedData: 'enc',
      iv: 'iv',
      salt: 'salt',
      algorithm: 'aes-256-gcm',
      createdAt: new Date('2026-07-17T12:00:00Z'),
      lastUsedAt: null,
      ...over,
    }) as WalletKeyEntity;

  const mkRecord = (
    over: Partial<WalletKeyRecord> = {},
  ): WalletKeyRecord => ({
    keyId: 'k-1',
    address: '0xabc',
    chainId: 1,
    isActive: true,
    createdAt: new Date('2026-07-17T12:00:00Z'),
    ...over,
  });

  beforeEach(() => {
    repo = {
      save: jest.fn((e) => Promise.resolve(e)),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    };
    store = new TypeOrmWalletKeyStore(repo as unknown as Repository<WalletKeyEntity>);
  });

  describe('saveKeyMeta', () => {
    it('persists metadata with empty encrypted columns', async () => {
      await store.saveKeyMeta(mkRecord());
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: 'k-1',
          address: '0xabc',
          chainId: 1,
          isActive: true,
          encryptedData: '',
          iv: '',
          salt: '',
          algorithm: 'aes-256-gcm',
          lastUsedAt: null,
        }),
      );
    });

    it('forwards lastUsedAt when provided', async () => {
      const ts = new Date('2026-07-17T10:00:00Z');
      await store.saveKeyMeta(mkRecord({ lastUsedAt: ts }));
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastUsedAt: ts }),
      );
    });
  });

  describe('getKeyMeta', () => {
    it('returns null when row is missing', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await store.getKeyMeta('k-x')).toBeNull();
    });

    it('maps row to WalletKeyRecord', async () => {
      repo.findOne.mockResolvedValue(mkRow());
      const record = await store.getKeyMeta('k-1');
      expect(record).toEqual({
        keyId: 'k-1',
        address: '0xabc',
        chainId: 1,
        isActive: true,
        createdAt: new Date('2026-07-17T12:00:00Z'),
        lastUsedAt: undefined,
      });
    });

    it('returns lastUsedAt when set', async () => {
      const ts = new Date('2026-07-17T15:00:00Z');
      repo.findOne.mockResolvedValue(mkRow({ lastUsedAt: ts }));
      const record = await store.getKeyMeta('k-1');
      expect(record?.lastUsedAt).toEqual(ts);
    });
  });

  describe('getAllKeyMeta', () => {
    it('returns empty list when no rows', async () => {
      repo.find.mockResolvedValue([]);
      expect(await store.getAllKeyMeta()).toEqual([]);
    });

    it('maps all rows to records', async () => {
      repo.find.mockResolvedValue([mkRow(), mkRow({ keyId: 'k-2' })]);
      const list = await store.getAllKeyMeta();
      expect(list).toHaveLength(2);
      expect(list[0]?.keyId).toBe('k-1');
      expect(list[1]?.keyId).toBe('k-2');
    });
  });

  describe('getKeysByChain', () => {
    it('queries by chainId', async () => {
      repo.find.mockResolvedValue([mkRow()]);
      await store.getKeysByChain(1);
      expect(repo.find).toHaveBeenCalledWith({ where: { chainId: 1 } });
    });
  });

  describe('saveEncryptedKey', () => {
    const enc: EncryptedKey = {
      keyId: 'k-1',
      encryptedData: 'enc2',
      iv: 'iv2',
      salt: 'salt2',
      algorithm: 'aes-256-gcm',
      createdAt: new Date(),
    };

    it('updates existing row encrypted columns', async () => {
      const existing = mkRow();
      repo.findOne.mockResolvedValue(existing);

      await store.saveEncryptedKey('k-1', enc);

      expect(existing.encryptedData).toBe('enc2');
      expect(existing.iv).toBe('iv2');
      expect(existing.salt).toBe('salt2');
      expect(existing.algorithm).toBe('aes-256-gcm');
      expect(repo.save).toHaveBeenCalledWith(existing);
    });

    it('inserts a new row when no existing record found', async () => {
      repo.findOne.mockResolvedValue(null);

      await store.saveEncryptedKey('k-1', enc);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: 'k-1',
          address: '',
          chainId: 0,
          isActive: true,
          encryptedData: 'enc2',
          iv: 'iv2',
          salt: 'salt2',
          algorithm: 'aes-256-gcm',
        }),
      );
    });
  });

  describe('getEncryptedKey', () => {
    it('returns null when row is missing', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await store.getEncryptedKey('k-x')).toBeNull();
    });

    it('returns null when encryptedData is empty', async () => {
      repo.findOne.mockResolvedValue(mkRow({ encryptedData: '' }));
      expect(await store.getEncryptedKey('k-1')).toBeNull();
    });

    it('returns EncryptedKey shape when row has encryptedData', async () => {
      const ts = new Date('2026-07-17T11:00:00Z');
      repo.findOne.mockResolvedValue(mkRow({ encryptedData: 'enc', createdAt: ts }));
      const result = await store.getEncryptedKey('k-1');
      expect(result).toEqual({
        keyId: 'k-1',
        encryptedData: 'enc',
        iv: 'iv',
        salt: 'salt',
        algorithm: 'aes-256-gcm',
        createdAt: ts,
      });
    });
  });

  describe('setActive', () => {
    it('logs warning and skips save when row missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await store.setActive('k-x', false);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('updates isActive and saves', async () => {
      const row = mkRow({ isActive: true });
      repo.findOne.mockResolvedValue(row);
      await store.setActive('k-1', false);
      expect(row.isActive).toBe(false);
      expect(repo.save).toHaveBeenCalledWith(row);
    });
  });

  describe('updateLastUsed', () => {
    it('forwards to repo.update with keyId + lastUsedAt', async () => {
      const ts = new Date('2026-07-17T18:00:00Z');
      await store.updateLastUsed('k-1', ts);
      expect(repo.update).toHaveBeenCalledWith({ keyId: 'k-1' }, { lastUsedAt: ts });
    });
  });
});
