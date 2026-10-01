import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createAppContext } = require('../appContext.js');

describe('set-token', () => {
  let cwd;
  let storeModule;
  let ctx;
  let invoke;
  let ctxSetClient;

  beforeEach(async () => {
    vi.resetModules();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-token-ipc-'));
    await import('../store.js');
    // Use the same CommonJS instance that tokens.js requires.
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
    require('./tokens.js').register(ipcMain, ctx);
    invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    ctx?.backup.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('does not save a token Airtable rejects, and keeps the old one', async () => {
    storeModule.setActiveToken('patOldGood.0123456789abcdef');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { type: 'AUTHENTICATION_REQUIRED' } }),
    });

    const result = await invoke('set-token', 'pat' + 'x'.repeat(25));

    expect(result.success).toBe(false);
    expect(result.code).toBe('bad-token');
    expect(storeModule.getActiveToken()).toBe('patOldGood.0123456789abcdef');
    expect(ctxSetClient).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.airtable.com/v0/meta/bases',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer pat' + 'x'.repeat(25) }),
      }),
    );
  });

  it('saves a token Airtable accepts', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bases: [{ id: 'appDemoOrders0001' }] }),
    });
    const result = await invoke('set-token', '  patNewGood.0123456789abcdef  ');
    expect(result).toEqual({ success: true, baseCount: 1 });
    expect(storeModule.getActiveToken()).toBe('patNewGood.0123456789abcdef');
  });

  it('rejects a retired legacy key without calling Airtable', async () => {
    const result = await invoke('set-token', 'key' + 'A'.repeat(14));
    expect(result.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
