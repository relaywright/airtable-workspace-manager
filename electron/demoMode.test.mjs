import { describe, it, expect, vi } from 'vitest';
import { createDemoMode, shouldRunScheduledRefresh } from './demoMode.js';

function makeDeps(overrides = {}) {
  return {
    switchDatabase: vi.fn().mockResolvedValue(undefined),
    getActiveAccountId: vi.fn().mockReturnValue('acct-1'),
    isSyncInProgress: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('createDemoMode', () => {
  it('enter switches to the demo database and records the previous account id', async () => {
    const deps = makeDeps();
    const demoMode = createDemoMode(deps);

    const result = await demoMode.enter();

    expect(result).toEqual({ success: true });
    expect(demoMode.isActive()).toBe(true);
    expect(demoMode.getPreviousAccountId()).toBe('acct-1');
    expect(deps.switchDatabase).toHaveBeenCalledWith('demo');
  });

  it('exit switches back to the recorded previous account', async () => {
    const deps = makeDeps({ getActiveAccountId: vi.fn().mockReturnValue('acct-2') });
    const demoMode = createDemoMode(deps);
    await demoMode.enter();
    deps.switchDatabase.mockClear();

    const result = await demoMode.exit();

    expect(result).toEqual({ success: true });
    expect(demoMode.isActive()).toBe(false);
    expect(deps.switchDatabase).toHaveBeenCalledWith('acct-2');
  });

  it('exit with no previous account switches back to null', async () => {
    const deps = makeDeps({ getActiveAccountId: vi.fn().mockReturnValue(null) });
    const demoMode = createDemoMode(deps);
    await demoMode.enter();
    deps.switchDatabase.mockClear();

    await demoMode.exit();

    expect(deps.switchDatabase).toHaveBeenCalledWith(null);
  });

  it('refuses to enter while a sync is in progress', async () => {
    const deps = makeDeps({ isSyncInProgress: vi.fn().mockReturnValue(true) });
    const demoMode = createDemoMode(deps);

    const result = await demoMode.enter();

    expect(result).toEqual({
      success: false,
      error: 'A sync or backup is in progress. Try again when it finishes.',
    });
    expect(demoMode.isActive()).toBe(false);
    expect(deps.switchDatabase).not.toHaveBeenCalled();
  });

  it('leaves mode inactive when switchDatabase throws on enter', async () => {
    const deps = makeDeps({ switchDatabase: vi.fn().mockRejectedValue(new Error('disk full')) });
    const demoMode = createDemoMode(deps);

    const result = await demoMode.enter();

    expect(result).toEqual({ success: false, error: 'disk full' });
    expect(demoMode.isActive()).toBe(false);
    expect(demoMode.getPreviousAccountId()).toBe(null);
  });

  it('enter is a no-op success when already active', async () => {
    const deps = makeDeps();
    const demoMode = createDemoMode(deps);
    await demoMode.enter();
    deps.switchDatabase.mockClear();

    const result = await demoMode.enter();

    expect(result).toEqual({ success: true });
    expect(deps.switchDatabase).not.toHaveBeenCalled();
  });

  it('exit is a no-op success when not active', async () => {
    const deps = makeDeps();
    const demoMode = createDemoMode(deps);

    const result = await demoMode.exit();

    expect(result).toEqual({ success: true });
    expect(deps.switchDatabase).not.toHaveBeenCalled();
  });

  it('pickClient returns the real client when inactive and a DemoAirtableClient when active', async () => {
    const deps = makeDeps();
    const demoMode = createDemoMode(deps);
    const realClient = { listBases: vi.fn() };

    expect(demoMode.pickClient(realClient)).toBe(realClient);

    await demoMode.enter();
    const picked = demoMode.pickClient(realClient);

    expect(picked).not.toBe(realClient);
    expect(typeof picked.listBases).toBe('function');
    expect(typeof picked.getBaseSchema).toBe('function');
    expect(typeof picked.fetchSchemasConcurrently).toBe('function');
  });

  it('never touches any dependency beyond the three injected', async () => {
    const deps = makeDeps();
    const demoMode = createDemoMode(deps);

    await demoMode.enter();
    await demoMode.exit();

    // Guards against a future edit adding a persistence call (e.g. a store
    // setter) that would violate the "never persist demo as active" rule
    // without any other test noticing.
    expect(Object.keys(deps).sort()).toEqual(['getActiveAccountId', 'isSyncInProgress', 'switchDatabase']);
  });
});

describe('shouldRunScheduledRefresh', () => {
  it('runs when a client exists, no sync is running, and demo is not active', () => {
    expect(shouldRunScheduledRefresh({ hasClient: true, syncInProgress: false, demoActive: false })).toBe(
      true,
    );
  });

  it('skips when there is no client', () => {
    expect(shouldRunScheduledRefresh({ hasClient: false, syncInProgress: false, demoActive: false })).toBe(
      false,
    );
  });

  it('skips when a sync is already in progress', () => {
    expect(shouldRunScheduledRefresh({ hasClient: true, syncInProgress: true, demoActive: false })).toBe(
      false,
    );
  });

  it('skips while demo mode is active, even with a real client configured', () => {
    expect(shouldRunScheduledRefresh({ hasClient: true, syncInProgress: false, demoActive: true })).toBe(
      false,
    );
  });
});
