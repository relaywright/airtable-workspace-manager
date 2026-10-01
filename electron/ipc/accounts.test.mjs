import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createAppContext } = require('../appContext.js');

describe('add-account', () => {
  let cwd;
  let storeModule;
  let ctx;
  let invoke;
  let ctxSetClient;

  beforeEach(async () => {
    vi.resetModules();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-account-ipc-'));
    await import('../store.js');
    // Use the same CommonJS instance that accounts.js requires.
    storeModule = require('../store.js');
    storeModule.createStore({
      cwd,
      codec: {
        isAvailable: () => true,
        encrypt: (value) => Buffer.from(`sealed:${value}`).toString('base64'),
        decrypt: (encoded) => Buffer.from(encoded, 'base64').toString().slice('sealed:'.length),
      },
    });
    const handlers = new Map();
    const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
    ctx = createAppContext({
      getActiveAccountId: storeModule.getActiveAccountId,
      switchDatabase: vi.fn().mockResolvedValue(undefined),
      getBackupRoot: () => path.join(cwd, 'backups'),
    });
    ctxSetClient = vi.spyOn(ctx, 'setAirtableClient');
    require('./accounts.js').register(ipcMain, ctx);
    invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    ctx?.backup.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('does not save an account when Airtable rejects its token', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { type: 'AUTHENTICATION_REQUIRED' } }),
    });
    vi.spyOn(ctx.demoMode, 'isActive').mockReturnValue(true);
    const exitDemo = vi.spyOn(ctx.demoMode, 'exit');

    const result = await invoke('add-account', 'Cedar & Pine Goods', 'patNewBad.fedcba9876543210');

    expect(result).toEqual({
      success: false,
      code: 'bad-token',
      error:
        "Airtable didn't accept this token. Check that you copied the whole token (it starts with \"pat\"), and that it hasn't been deleted on Airtable's token page.",
      helpUrl: 'https://airtable.com/create/tokens',
    });
    expect(storeModule.getAccounts()).toEqual([]);
    expect(ctxSetClient).not.toHaveBeenCalled();
    expect(exitDemo).not.toHaveBeenCalled();
  });

  it('rejects a retired legacy key without calling Airtable', async () => {
    const result = await invoke('add-account', 'Cedar & Pine Goods', 'key' + 'A'.repeat(14));

    expect(result.success).toBe(false);
    expect(result.code).toBe('bad-token');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(storeModule.getAccounts()).toEqual([]);
    expect(ctxSetClient).not.toHaveBeenCalled();
  });

  it('saves an accepted token trimmed and activates the first account', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ bases: [{ id: 'appDemoOrders0001' }] }),
    });

    const result = await invoke('add-account', '  Cedar & Pine Goods  ', '  patNewGood.0123456789abcdef  ');

    expect(result).toEqual({
      success: true,
      data: {
        id: expect.any(String),
        name: 'Cedar & Pine Goods',
        createdAt: expect.any(String),
        lastUsedAt: expect.any(String),
      },
    });
    expect(storeModule.getAccounts()).toEqual([result.data]);
    expect(storeModule.getActiveAccount()).toEqual(result.data);
    expect(storeModule.getAccountToken(result.data.id)).toBe('patNewGood.0123456789abcdef');
    expect(storeModule.getActiveToken()).toBe('patNewGood.0123456789abcdef');
    expect(ctxSetClient).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.airtable.com/v0/meta/bases',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer patNewGood.0123456789abcdef' }),
      }),
    );
  });
});
