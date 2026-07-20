import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import type { BridgeAdapter } from './bridge-adapter.interface';
import { AcrossBridgeAdapter } from './across-bridge.adapter';
import { StargateBridgeAdapter } from './stargate-bridge.adapter';
import { NativeBridgeAdapter } from './native-bridge.adapter';
import {
  BridgeAdapterFactoryService,
  extractBridgeParams,
} from './bridge-adapter-factory.service';

/**
 * BridgeAdapterFactoryService + extractBridgeParams spec (DEX-2-1-BRIDGE-ACROSS).
 *
 * The factory only wires three pre-built adapters and exposes a Map. The bulk
 * of the file's logic is `extractBridgeParams` — a pure function that maps
 * playbookConfig shapes into `BridgeLegParams`. Tests cover every branch.
 */
function mkAdapter(key: string): BridgeAdapter {
  return { bridgeKey: key } as BridgeAdapter;
}

describe('BridgeAdapterFactoryService', () => {
  let factory: BridgeAdapterFactoryService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    // The factory constructor only reads `adapter.bridgeKey` from each adapter
    // (no other method is invoked at construction), so the lightweight stubs
    // are sufficient for routing and registration tests.
    factory = new BridgeAdapterFactoryService(
      mkAdapter('across') as AcrossBridgeAdapter,
      mkAdapter('stargate') as StargateBridgeAdapter,
      mkAdapter('native') as NativeBridgeAdapter,
    );
  });

  describe('resolveAdapter', () => {
    it('returns the registered adapter for each known key', () => {
      expect(factory.resolveAdapter('across').bridgeKey).toBe('across');
      expect(factory.resolveAdapter('stargate').bridgeKey).toBe('stargate');
      expect(factory.resolveAdapter('native').bridgeKey).toBe('native');
    });

    it('throws when bridgeKey is not recognised', () => {
      expect(() => factory.resolveAdapter('wormhole')).toThrow(/unknown bridgeKey/);
    });
  });

  describe('hasAdapter', () => {
    it('returns true for registered keys', () => {
      expect(factory.hasAdapter('across')).toBe(true);
      expect(factory.hasAdapter('stargate')).toBe(true);
      expect(factory.hasAdapter('native')).toBe(true);
    });

    it('returns false for unregistered keys', () => {
      expect(factory.hasAdapter('wormhole')).toBe(false);
      expect(factory.hasAdapter('')).toBe(false);
    });
  });

  describe('getRegisteredBridgeKeys', () => {
    it('lists all registered keys', () => {
      const keys = factory.getRegisteredBridgeKeys().sort();
      expect(keys).toEqual(['across', 'native', 'stargate']);
    });
  });

  describe('getAllAdapters', () => {
    it('exposes the internal adapter map', () => {
      const all = factory.getAllAdapters();
      expect(all.size).toBe(3);
      expect(all.get('across')?.bridgeKey).toBe('across');
    });
  });
});

describe('extractBridgeParams', () => {
  const planId = 'p-1';
  const legId = 'l-1';

  it('returns undefined when playbookConfig is null', () => {
    expect(extractBridgeParams(null, 0, planId, legId)).toBeUndefined();
  });

  it('returns undefined when playbookConfig is undefined', () => {
    expect(extractBridgeParams(undefined, 0, planId, legId)).toBeUndefined();
  });

  it('extracts params from multi-leg config with bridgeKey', () => {
    const playbook = {
      legs: [
        {
          bridgeKey: 'across',
          chainId: 42161,
          destinationChainId: 8453,
          token: '0xtoken',
          destinationToken: '0xdsttoken',
          amount: '1000',
          recipientAddress: '0xrecipient',
        },
      ],
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result).toEqual({
      bridgeKey: 'across',
      sourceChainId: 42161,
      destinationChainId: 8453,
      token: '0xtoken',
      destinationToken: '0xdsttoken',
      amount: 1000n,
      recipientAddress: '0xrecipient',
    });
  });

  it('extracts params from multi-leg config using legType=bridge', () => {
    const playbook = {
      legs: [
        {
          legType: 'bridge',
          bridgeKey: 'native',
          sourceChainId: 10,
          destinationChainId: 42161,
          tokenAddress: '0xtokena',
          destinationTokenAddress: '0xtokenb',
          amount: 42,
          recipient: '0xrecip',
        },
      ],
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result).toEqual({
      bridgeKey: 'native',
      sourceChainId: 10,
      destinationChainId: 42161,
      token: '0xtokena',
      destinationToken: '0xtokenb',
      amount: 42n,
      recipientAddress: '0xrecip',
    });
  });

  it('returns undefined when leg entry exists but is not a bridge leg', () => {
    const playbook = {
      legs: [{ legType: 'dex', chainId: 1 }],
    };
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });

  it('returns undefined when legIndex is out of bounds', () => {
    const playbook = { legs: [{ bridgeKey: 'across' }] };
    expect(extractBridgeParams(playbook, 5, planId, legId)).toBeUndefined();
  });

  it('returns undefined when legs is not an array', () => {
    const playbook = { legs: 'not-an-array' };
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });

  it('returns undefined when leg entry is missing required fields', () => {
    const playbook = { legs: [{ bridgeKey: 'across' }] }; // missing chains/token/amount
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });

  it('returns undefined when amount is not a valid BigInt', () => {
    const playbook = {
      legs: [
        {
          bridgeKey: 'across',
          chainId: 1,
          destinationChainId: 2,
          token: '0xt',
          destinationToken: '0xdt',
          amount: 'not-a-bigint',
        },
      ],
    };
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });

  it('extracts params from legacy dexSwaps config', () => {
    const playbook = {
      dexSwaps: [
        {
          bridgeKey: 'stargate',
          sourceChainId: 137,
          destinationChainId: 42161,
          token: '0xtoken',
          destinationToken: '0xdt',
          amount: '100',
          recipientAddress: '0xr',
        },
      ],
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result).toEqual({
      bridgeKey: 'stargate',
      sourceChainId: 137,
      destinationChainId: 42161,
      token: '0xtoken',
      destinationToken: '0xdt',
      amount: 100n,
      recipientAddress: '0xr',
    });
  });

  it('skips dexSwaps entry when bridgeKey is missing', () => {
    const playbook = {
      dexSwaps: [{ sourceChainId: 1 }], // no bridgeKey
    };
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });

  it('falls back to bridgeDefaults when no leg-level config present', () => {
    const playbook = {
      bridgeDefaults: {
        bridgeKey: 'native',
        sourceChainId: 1,
        destinationChainId: 8453,
        token: '0xt',
        destinationToken: '0xdt',
        amount: '55',
        recipientAddress: '0xr',
      },
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result?.bridgeKey).toBe('native');
    expect(result?.amount).toBe(55n);
  });

  it('returns undefined when bridgeDefaults object is present but invalid', () => {
    const playbook = { bridgeDefaults: { foo: 'bar' } };
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });

  it('uses amount as number when given as number', () => {
    const playbook = {
      legs: [
        {
          bridgeKey: 'across',
          chainId: 1,
          destinationChainId: 2,
          token: '0xt',
          destinationToken: '0xdt',
          amount: 9999,
          recipientAddress: '0xr',
        },
      ],
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result?.amount).toBe(9999n);
  });

  it('defaults recipientAddress to empty string when not provided', () => {
    const playbook = {
      legs: [
        {
          bridgeKey: 'across',
          chainId: 1,
          destinationChainId: 2,
          token: '0xt',
          destinationToken: '0xdt',
          amount: '10',
          // recipientAddress omitted
        },
      ],
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result?.recipientAddress).toBe('');
  });

  it('parses sourceChainId from numeric string', () => {
    const playbook = {
      legs: [
        {
          bridgeKey: 'across',
          chainId: '42161', // string-formatted number
          destinationChainId: '8453',
          token: '0xt',
          destinationToken: '0xdt',
          amount: '10',
          recipientAddress: '0xr',
        },
      ],
    };
    const result = extractBridgeParams(playbook, 0, planId, legId);
    expect(result?.sourceChainId).toBe(42161);
    expect(result?.destinationChainId).toBe(8453);
  });

  it('returns undefined when sourceChainId is non-numeric', () => {
    const playbook = {
      legs: [
        {
          bridgeKey: 'across',
          chainId: 'not-a-number',
          destinationChainId: 2,
          token: '0xt',
          destinationToken: '0xdt',
          amount: '10',
        },
      ],
    };
    expect(extractBridgeParams(playbook, 0, planId, legId)).toBeUndefined();
  });
});
