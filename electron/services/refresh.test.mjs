import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('refreshAllSchemas', () => {
  it('returns the in-progress error and leaves the lock held when a sync is already running', async () => {
    const { refreshAllSchemas } = require('./refresh.js');

    const ctx = {
      syncInProgress: true,
      demoMode: { pickClient: (realClient) => realClient },
      airtableClient: { listBases: async () => [] },
    };

    const result = await refreshAllSchemas(ctx);

    expect(result).toEqual({
      success: false,
      error: 'A sync is already in progress. Please wait for it to finish.',
    });
    // The rejected concurrent call must not release the lock held by the
    // sync that is actually running.
    expect(ctx.syncInProgress).toBe(true);
  });
});
