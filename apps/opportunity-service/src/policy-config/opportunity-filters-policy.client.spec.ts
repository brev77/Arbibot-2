import {
  OPPORTUNITY_FILTERS_POLICY_KEY,
  fetchOpportunityFiltersEffective,
} from './opportunity-filters-policy.client';

describe('fetchOpportunityFiltersEffective', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null on 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const r = await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(r).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://cfg.test/policy/configurations/${encodeURIComponent(OPPORTUNITY_FILTERS_POLICY_KEY)}/effective`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('parses configValue JSON on success', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        configValue: JSON.stringify({ minSpreadBps: 12 }),
      }),
    });

    const r = await fetchOpportunityFiltersEffective('http://cfg.test/', {
      environment: 'staging',
    });
    expect(r).toEqual({ minSpreadBps: 12 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://cfg.test/policy/configurations/${encodeURIComponent(OPPORTUNITY_FILTERS_POLICY_KEY)}/effective?environment=staging`,
      expect.anything(),
    );
  });
});
