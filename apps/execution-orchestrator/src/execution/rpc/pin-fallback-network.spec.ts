/**
 * Targeted tests for pinFallbackNetwork — the fix that closes the FallbackProvider
 * gap in PLAN11 #46 (staticNetwork pin only covers single-provider path).
 *
 * These tests run against the REAL ethers (no jest.mock), because the parent spec
 * mocks the whole ethers module and cannot exercise the real FallbackProvider
 * network-detection code path.
 *
 * Regression scenario: FallbackProvider._detectNetwork dispatches a live
 * eth_chainId to each child via _translatePerform → provider.getNetwork(), which
 * defeats the child's staticNetwork pin. With a load-balanced RPC that returns
 * chainId=1 for one call and 42161 for the next, AbstractProvider.getNetwork()
 * throws `NETWORK_ERROR: network changed: 1 => 42161`. After pinFallbackNetwork,
 * _detectNetwork returns the pinned chainId without any RPC, so this cannot fire.
 *
 * See docs/plan-hermes-live-correctness-2026-08-06.md §9 (post-Hermes correction).
 */
import { JsonRpcProvider, FallbackProvider } from 'ethers';
import { pinFallbackNetwork } from './rpc-provider-manager.service';

// A URL that will not respond to RPC (connection refused / no server). Used to
// prove that _detectNetwork does NOT issue an RPC call after pinning — if it did,
// it would hang or throw on this unreachable endpoint within the test timeout.
const DEAD_URL = 'http://127.0.0.1:1'; // port 1: nothing listening, fails fast

describe('pinFallbackNetwork', () => {
  it('makes _detectNetwork return the pinned chainId without any RPC call', async () => {
    const a = new JsonRpcProvider(DEAD_URL, 42161, { staticNetwork: true });
    const b = new JsonRpcProvider(DEAD_URL, 42161, { staticNetwork: true });
    const fb = new FallbackProvider([a, b], 42161, { quorum: 1 });
    const pinned = pinFallbackNetwork(fb, 42161);

    // If _detectNetwork issued a live eth_chainId, it would hang/fail on DEAD_URL.
    // The pin must short-circuit and return chainId 42161 immediately.
    const network = await pinned._detectNetwork();
    expect(Number(network.chainId)).toBe(42161);
  });

  it('getNetwork() does not throw NETWORK_ERROR when the pin is applied', async () => {
    // Without the pin, getNetwork() compares the cached network against a fresh
    // _detectNetwork() and would throw on mismatch. With the pin, both sides
    // resolve to the same fixed chainId, so no mismatch is possible.
    const a = new JsonRpcProvider(DEAD_URL, 42161, { staticNetwork: true });
    const fb = new FallbackProvider([a], 42161, { quorum: 1 });
    const pinned = pinFallbackNetwork(fb, 42161);

    const network = await pinned.getNetwork();
    expect(Number(network.chainId)).toBe(42161);
  });

  it('returns the same provider instance (patch in place, not wrap)', () => {
    const a = new JsonRpcProvider(DEAD_URL, 42161, { staticNetwork: true });
    const fb = new FallbackProvider([a], 42161, { quorum: 1 });
    const result = pinFallbackNetwork(fb, 42161);
    expect(result).toBe(fb);
  });
});
