import { IncidentBriefsService } from './incident-briefs.service';
import { OpenclawUpstreamService } from './openclaw-upstream.service';

describe('IncidentBriefsService', () => {
  it('maps mismatches to brief items', async () => {
    const upstream = {
      getJson: jest.fn().mockResolvedValue({
        status: 200,
        json: {
          items: [
            {
              id: 'm1',
              kind: 'k',
              status: 'open',
              details: { hint: 'hello' },
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      }),
    } as unknown as OpenclawUpstreamService;
    const svc = new IncidentBriefsService(upstream);
    const out = await svc.buildBriefs();
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.summary).toBe('hello');
  });

  it('returns empty on upstream error', async () => {
    const upstream = {
      getJson: jest.fn().mockResolvedValue({ status: 500, json: {} }),
    } as unknown as OpenclawUpstreamService;
    const svc = new IncidentBriefsService(upstream);
    const out = await svc.buildBriefs();
    expect(out.items).toHaveLength(0);
  });
});
