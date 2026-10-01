import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
// Load everything through require() so this test shares the exact database
// module instance the IPC handlers use.
const require = createRequire(import.meta.url);
const { database, switchDatabase, __setTestUserDataPath } = require('../database.js');
const { createAppContext } = require('../appContext.js');
const { hasSchemaChanged } = require('../schemaDiff.js');
const demoIpc = require('./demo.js');
const analysisIpc = require('./analysis.js');
const settingsIpc = require('./settings.js');
const backupIpc = require('./backup.js');

const REAL_LAST_SYNC = '2026-01-15T09:00:00.000Z';

function setup(tmpDir) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const stored = { lastSync: REAL_LAST_SYNC };
  const ctx = createAppContext({
    getActiveAccountId: () => 'acct1',
    switchDatabase,
    getBackupRoot: () => path.join(tmpDir, 'backups'),
  });
  ctx.store = {
    get: (key) => stored[key],
    set: (key, value) => {
      stored[key] = value;
    },
  };
  for (const mod of [demoIpc, analysisIpc, settingsIpc, backupIpc]) mod.register(ipcMain, ctx);
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  return { invoke, stored, ctx };
}

describe('enter-demo-mode', () => {
  let tmpDir;
  let testCtx;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-demo-ipc-'));
    __setTestUserDataPath(tmpDir);
    await switchDatabase('acct1');
  });

  afterEach(() => {
    testCtx?.backup.close();
    database.close();
    __setTestUserDataPath(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds schema history once and shows a demo sync time without touching the real one', async () => {
    const { invoke, stored, ctx } = setup(tmpDir);
    testCtx = ctx;

    expect(await invoke('enter-demo-mode')).toEqual({ success: true });

    const overview = await invoke('get-backup-overview');
    expect(overview.success).toBe(true);
    expect(overview.data.bases.map((b) => b.baseName).sort()).toEqual([
      'Orders & Fulfillment',
      'Product Catalog',
      'Suppliers & Purchasing',
    ]);
    const pointCounts = overview.data.bases.map((b) => b.restorePointCount);
    pointCounts.forEach((n) => expect(n).toBeGreaterThanOrEqual(3));

    const snapshots = database.getAllSnapshots(1000);
    const changedBases = new Set(snapshots.map((s) => s.baseId));
    expect(changedBases.size).toBeGreaterThanOrEqual(6);
    expect(snapshots.length).toBeGreaterThanOrEqual(20);

    // Each seeded version must differ from the next newer one (the newest
    // from the current schema), or the Change Log would list empty changes.
    for (const baseId of changedBases) {
      const versions = database.getSnapshots(baseId, 100).map((s) => s.schemaJson);
      const newer = [database.getBase(baseId).schemaJson, ...versions];
      versions.forEach((version, i) => expect(hasSchemaChanged(version, newer[i])).toBe(true));
    }

    const health = await invoke('get-health-stats');
    const demoSync = health.data.overview.lastSyncTime;
    expect(demoSync).toBeTruthy();
    expect(demoSync).not.toBe(REAL_LAST_SYNC);
    expect(health.data.changes.last30Days).toBeGreaterThanOrEqual(6);
    expect((await invoke('get-last-sync')).data).toBe(demoSync);

    // The renderer stamps a sync time after every refresh; in demo mode that
    // must stay out of the real account's stored value.
    await invoke('set-last-sync', '2026-09-01T00:00:00.000Z');
    expect(stored.lastSync).toBe(REAL_LAST_SYNC);

    await invoke('exit-demo-mode');
    expect((await invoke('get-last-sync')).data).toBe(REAL_LAST_SYNC);

    // Re-entering reuses the demo database and must not seed a second copy.
    expect(await invoke('enter-demo-mode')).toEqual({ success: true });
    expect(database.getAllSnapshots(1000)).toHaveLength(snapshots.length);

    // Re-entering rebuilds the demo backups instead of stacking a second copy.
    const again = await invoke('get-backup-overview');
    expect(again.data.bases.map((b) => b.restorePointCount)).toEqual(pointCounts);
  });
});
