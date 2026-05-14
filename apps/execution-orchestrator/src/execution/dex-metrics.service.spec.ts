import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { DexMetricsService } from './dex-metrics.service';

describe('DexMetricsService', () => {
  let service: DexMetricsService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    service = new DexMetricsService();
  });

  afterEach(() => {
    getArbibotMetricsRegistry().clear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register all 6 metrics', () => {
    const metrics = getArbibotMetricsRegistry().getMetricsAsArray();
    const names = metrics.map((m) => m.name);

    expect(names).toContain('arb_dex_rpc_latency_seconds');
    expect(names).toContain('arb_dex_gas_price_gwei');
    expect(names).toContain('arb_dex_swap_total');
    expect(names).toContain('arb_dex_confirmation_seconds');
    expect(names).toContain('arb_dex_signature_seconds');
    expect(names).toContain('arb_dex_broadcast_seconds');
  });

  it('should record RPC latency', async () => {
    service.recordRpcLatency(42161, 'eth_call', 50);
    const val = await getArbibotMetricsRegistry()
      .getSingleMetricAsString('arb_dex_rpc_latency_seconds');
    expect(val).toContain('chain_id="42161"');
    expect(val).toContain('method="eth_call"');
  });

  it('should set gas price gauge', async () => {
    service.setGasPrice(42161, 1.5, 0.3);
    const val = await getArbibotMetricsRegistry()
      .getSingleMetricAsString('arb_dex_gas_price_gwei');
    expect(val).toContain('chain_id="42161"');
    expect(val).toContain('type="base_fee"');
    expect(val).toContain('type="priority_fee"');
    expect(val).toContain('1.5');
    expect(val).toContain('0.3');
  });

  it('should increment swap counter', async () => {
    service.incrementSwap('uniswap-v2', 42161, 'success');
    service.incrementSwap('uniswap-v3', 42161, 'failed');
    service.incrementSwap('uniswap-v2', 8453, 'reverted');

    const val = await getArbibotMetricsRegistry()
      .getSingleMetricAsString('arb_dex_swap_total');
    expect(val).toContain('adapter="uniswap-v2",chain_id="42161",status="success"');
    expect(val).toContain('adapter="uniswap-v3",chain_id="42161",status="failed"');
    expect(val).toContain('adapter="uniswap-v2",chain_id="8453",status="reverted"');
  });

  it('should record confirmation latency', async () => {
    service.recordConfirmation(42161, 'mainnet', 12000);
    const val = await getArbibotMetricsRegistry()
      .getSingleMetricAsString('arb_dex_confirmation_seconds');
    expect(val).toContain('chain_id="42161"');
    expect(val).toContain('network="mainnet"');
  });

  it('should record signature and broadcast latency', async () => {
    service.recordSignature(42161, 15);
    service.recordBroadcast(42161, 80);

    const sigVal = await getArbibotMetricsRegistry()
      .getSingleMetricAsString('arb_dex_signature_seconds');
    expect(sigVal).toContain('chain_id="42161"');

    const bcastVal = await getArbibotMetricsRegistry()
      .getSingleMetricAsString('arb_dex_broadcast_seconds');
    expect(bcastVal).toContain('chain_id="42161"');
  });

  it('timer helpers should record metrics on end()', async () => {
    // Use a small sleep to ensure measurable duration
    const rpcTimer = service.startRpcTimer(42161, 'eth_getBalance');
    await new Promise((r) => setTimeout(r, 5));
    const rpcMs = rpcTimer.end();
    expect(rpcMs).toBeGreaterThanOrEqual(4);

    const sigTimer = service.startSignatureTimer(42161);
    const sigMs = sigTimer.end();
    expect(sigMs).toBeGreaterThanOrEqual(0);

    const bcastTimer = service.startBroadcastTimer(42161);
    const bcastMs = bcastTimer.end();
    expect(bcastMs).toBeGreaterThanOrEqual(0);

    const confTimer = service.startConfirmationTimer(42161, 'testnet');
    const confMs = confTimer.end();
    expect(confMs).toBeGreaterThanOrEqual(0);

    // Verify all metrics have data
    const metrics = await getArbibotMetricsRegistry().metrics();
    expect(metrics).toContain('arb_dex_rpc_latency_seconds');
    expect(metrics).toContain('arb_dex_signature_seconds');
    expect(metrics).toContain('arb_dex_broadcast_seconds');
    expect(metrics).toContain('arb_dex_confirmation_seconds');
  });

  it('should expose registry via getRegistry()', () => {
    const reg = service.getRegistry();
    expect(reg).toBeDefined();
    expect(reg).toBe(getArbibotMetricsRegistry());
  });

  it('should produce non-empty output on /metrics grep for arb_dex_', async () => {
    // Record at least one data point per metric
    service.recordRpcLatency(42161, 'eth_call', 10);
    service.setGasPrice(42161, 2.0, 0.5);
    service.incrementSwap('uniswap-v2', 42161, 'success');
    service.recordConfirmation(42161, 'mainnet', 5000);
    service.recordSignature(42161, 20);
    service.recordBroadcast(42161, 100);

    const output = await getArbibotMetricsRegistry().metrics();
    const dexLines = output.split('\n').filter((l: string) => l.startsWith('arb_dex_'));
    expect(dexLines.length).toBeGreaterThan(0);
  });
});