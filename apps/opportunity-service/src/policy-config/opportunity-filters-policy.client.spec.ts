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

  it('returns null on non-2xx non-404 status', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    const r = await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(r).toBeNull();
  });

  it('returns null when configValue is not a string (defensive)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ configValue: { not: 'a string' } }),
    });
    const r = await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(r).toBeNull();
  });

  it('returns null when configValue is missing from the response body', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({}),
    });
    const r = await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(r).toBeNull();
  });

  it('returns null when fetch throws (network failure)', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(r).toBeNull();
  });

  it('returns null when the response body is unparseable JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => {
        throw new Error('invalid json');
      },
    });
    const r = await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(r).toBeNull();
  });

  it('forwards tenantId as query-string when provided', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ configValue: JSON.stringify({}) }),
    });
    globalThis.fetch = fetchFn;
    await fetchOpportunityFiltersEffective('http://cfg.test', {
      tenantId: 't1',
    });
    expect(fetchFn.mock.calls[0]?.[0]).toContain('tenantId=t1');
  });

  it('builds the URL without query-string when neither environment nor tenantId provided', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ configValue: JSON.stringify({}) }),
    });
    globalThis.fetch = fetchFn;
    await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(fetchFn.mock.calls[0]?.[0]).not.toContain('?');
  });

  it('URL-encodes the policy key when building the URL', async () => {
    // The key 'opportunity.filters' has a dot — encodeURIComponent leaves it
    // intact (dots are unreserved), but the path still goes through the
    // encoder. Verify by inspecting the URL string.
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({ configValue: JSON.stringify({}) }),
    });
    globalThis.fetch = fetchFn;
    await fetchOpportunityFiltersEffective('http://cfg.test');
    expect(fetchFn.mock.calls[0]?.[0]).toContain(
      `/policy/configurations/${OPPORTUNITY_FILTERS_POLICY_KEY}/effective`,
    );
  });
});
