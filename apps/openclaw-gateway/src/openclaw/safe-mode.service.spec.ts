import { SafeModeService } from './safe-mode.service';

describe('SafeModeService', () => {
  const prevMemory = process.env.OPENCLAW_SAFE_MODE_USE_MEMORY_ONLY;

  beforeEach(() => {
    process.env.OPENCLAW_SAFE_MODE_USE_MEMORY_ONLY = 'true';
  });

  afterEach(() => {
    process.env.OPENCLAW_SAFE_MODE_USE_MEMORY_ONLY = prevMemory;
  });

  it('toggles enabled flag', async () => {
    const s = new SafeModeService();
    expect((await s.getState()).enabled).toBe(false);
    await s.enable('a', 'r');
    expect((await s.getState()).enabled).toBe(true);
    await s.disable('a');
    expect((await s.getState()).enabled).toBe(false);
  });
});
