import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Stands in for Electron's safeStorage, which does not exist under ELECTRON_RUN_AS_NODE.
function createFakeCodec({ available = true } = {}) {
  const codec = {
    available,
    isAvailable: () => codec.available,
    encrypt: (value) => Buffer.from(`sealed:${[...value].reverse().join('')}`).toString('base64'),
    decrypt: (encoded) => {
      const raw = Buffer.from(encoded, 'base64').toString();
      if (!raw.startsWith('sealed:')) throw new Error('not sealed by this codec');
      return [...raw.slice('sealed:'.length)].reverse().join('');
    },
  };
  return codec;
}

describe('secret encryption migration', () => {
  const workToken = 'patWorkAbc123.0123456789abcdef';
  const personalToken = 'patPersonalXyz789.fedcba9876543210';
  const aiKey = 'sk-ant-test-0123456789abcdef';
  let cwd;

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-store-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('encrypts a plaintext config, clears the plaintext, and is a no-op the second time', async () => {
    const storeModule = await import('./store.js');
    const codec = createFakeCodec();

    // A config written by an earlier version: every secret in plaintext.
    const legacy = storeModule.createStore({ cwd });
    legacy.set({
      apiToken: workToken,
      anthropicApiKey: aiKey,
      accounts: [
        { id: '1', name: 'Work', token: workToken, createdAt: 'x', lastUsedAt: 'x' },
        { id: '2', name: 'Personal', token: personalToken, createdAt: 'x', lastUsedAt: 'x' },
      ],
      activeAccountId: '1',
      nextAccountId: 3,
    });

    const store = storeModule.createStore({ codec, cwd });
    const raw = store.store;
    expect(raw.apiToken).toBe('');
    expect(raw.anthropicApiKey).toBe('');
    expect(raw.apiTokenEnc).toBeTruthy();
    expect(raw.anthropicApiKeyEnc).toBeTruthy();
    for (const account of raw.accounts) {
      expect(account).not.toHaveProperty('token');
      expect(account.tokenEnc).toBeTruthy();
    }
    const serialized = JSON.stringify(raw);
    for (const secret of [workToken, personalToken, aiKey]) {
      expect(serialized).not.toContain(secret);
    }

    expect(storeModule.getActiveToken()).toBe(workToken);
    expect(storeModule.getAccountToken('1')).toBe(workToken);
    expect(storeModule.getAccountToken('2')).toBe(personalToken);
    expect(storeModule.getAnthropicKey()).toBe(aiKey);
    expect(storeModule.getAccounts().map((a) => a.name)).toEqual(['Work', 'Personal']);

    storeModule.createStore({ codec, cwd });
    expect(storeModule.getStore().store).toEqual(raw);

    storeModule.setActiveAccount('2');
    expect(storeModule.getActiveToken()).toBe(personalToken);
  });

  it('preserves the newer legacy active token when switching accounts after migration', async () => {
    const storeModule = await import('./store.js');
    const codec = createFakeCodec();
    const newToken = 'patNEWtoken000000000001';
    const oldToken = 'patOLDtoken000000000001';
    const otherToken = 'patTESTtoken000000000002';

    storeModule.createStore({ cwd }).set({
      apiToken: newToken,
      accounts: [
        { id: '1', name: 'Cedar & Pine', token: oldToken, createdAt: 'x', lastUsedAt: 'x' },
        { id: '2', name: 'Second workspace', token: otherToken, createdAt: 'x', lastUsedAt: 'x' },
      ],
      activeAccountId: '1',
      nextAccountId: 3,
    });

    const store = storeModule.createStore({ codec, cwd });
    expect(storeModule.getAccountToken('1')).toBe(newToken);
    expect(storeModule.getActiveToken()).toBe(newToken);
    const migrated = store.store;
    storeModule.createStore({ codec, cwd });
    expect(storeModule.getStore().store).toEqual(migrated);

    storeModule.setActiveAccount('2');
    expect(storeModule.getActiveToken()).toBe(otherToken);
    storeModule.setActiveAccount('1');
    expect(storeModule.getActiveToken()).toBe(newToken);
  });

  it('keeps working without a keyring, then encrypts once one is available', async () => {
    const storeModule = await import('./store.js');
    const codec = createFakeCodec({ available: false });

    // Oldest format: a single token and no accounts yet.
    storeModule.createStore({ cwd }).set('apiToken', workToken);

    const store = storeModule.createStore({ codec, cwd });
    expect(store.get('apiToken')).toBe(workToken);
    expect(storeModule.getAccountToken('1')).toBe(workToken);
    expect(storeModule.getActiveToken()).toBe(workToken);
    expect(console.warn).toHaveBeenCalledWith(
      '[Store]',
      expect.stringContaining('encryption is unavailable'),
    );

    codec.available = true;
    storeModule.createStore({ codec, cwd });
    expect(storeModule.getStore().get('apiToken')).toBe('');
    expect(storeModule.getStore().get('accounts')[0]).not.toHaveProperty('token');
    expect(storeModule.getActiveToken()).toBe(workToken);
    expect(storeModule.getAccountToken('1')).toBe(workToken);
  });
});

// Note: electron-store requires the real Electron runtime, so we test the module's
// exported functions and their behaviors rather than mocking the store completely

describe('Store Module', () => {
  describe('getStore without initialization', () => {
    it('throws error when store not initialized', async () => {
      // Reset modules to get a fresh module without store initialized
      vi.resetModules();

      // Import a fresh copy of the module
      const { getStore } = await import('./store.js');

      // First call to getStore should throw since store isn't created yet
      expect(() => getStore()).toThrow('Store not initialized');
    });
  });

  describe('createStore and getStore', () => {
    it('createStore returns a store object', async () => {
      vi.resetModules();
      const { createStore } = await import('./store.js');
      const store = createStore();

      expect(store).toBeDefined();
      expect(typeof store).toBe('object');
    });

    it('getStore returns the created store', async () => {
      vi.resetModules();
      const { createStore, getStore } = await import('./store.js');

      const createdStore = createStore();
      const retrievedStore = getStore();

      expect(retrievedStore).toBe(createdStore);
    });

    it('store has get method', async () => {
      vi.resetModules();
      const { createStore } = await import('./store.js');
      const store = createStore();

      expect(typeof store.get).toBe('function');
    });

    it('store has set method', async () => {
      vi.resetModules();
      const { createStore } = await import('./store.js');
      const store = createStore();

      expect(typeof store.set).toBe('function');
    });

    it('store.get returns default empty string for apiToken', async () => {
      vi.resetModules();
      const { createStore } = await import('./store.js');
      const store = createStore();

      // apiToken has default of '' per schema
      const token = store.get('apiToken');
      expect(token).toBe('');
    });

    it('store.set and get work together', async () => {
      vi.resetModules();
      const { createStore } = await import('./store.js');
      const store = createStore();

      store.set('lastSync', '2024-01-01T00:00:00Z');
      const value = store.get('lastSync');
      expect(value).toBe('2024-01-01T00:00:00Z');

      // Clean up
      store.set('lastSync', '');
    });

    it('store.get returns default for lastSync', async () => {
      vi.resetModules();
      const { createStore } = await import('./store.js');
      const store = createStore();

      // Reset lastSync to default
      store.set('lastSync', '');
      const lastSync = store.get('lastSync');
      expect(lastSync).toBe('');
    });
  });
});
