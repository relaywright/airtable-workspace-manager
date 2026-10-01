import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createBackupService } = require('./backup.js');
const { createAppContext } = require('../appContext.js');

const BASE = { id: 'appTestService001', name: 'Service Base' };
const TABLE = {
  id: 'tblTestService001',
  name: 'Things',
  fields: [{ id: 'fldTestService001', name: 'Name', type: 'singleLineText' }],
};

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeClient({ gate } = {}) {
  return {
    async getBaseSchema() {
      if (gate) await gate.promise;
      return { tables: [TABLE] };
    },
    async listRecords() {
      return {
        records: [
          {
            id: 'recTestService001',
            createdTime: '2026-09-01T00:00:00.000Z',
            fields: { fldTestService001: 'One' },
          },
        ],
      };
    },
    async downloadFile() {
      throw new Error('This test has no files');
    },
  };
}

describe('backup service', () => {
  let root;
  let key;
  let service;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm backup service é-'));
    key = 'acct1';
    service = createBackupService({ getRootFolder: () => root, getAccountKey: () => key });
  });

  afterEach(() => {
    service.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses a second backup while one is running', async () => {
    const gate = deferred();
    const first = service.runNow({ client: fakeClient({ gate }), bases: [BASE] });
    expect(service.isRunning()).toBe(true);
    expect(await service.runNow({ client: fakeClient(), bases: [BASE] })).toEqual({
      success: false,
      error: expect.stringMatching(/already running/),
    });
    gate.resolve();
    expect((await first).data.results[0].status).toBe('complete');
    expect(service.isRunning()).toBe(false);
  });

  it('keeps a running backup safe when the account changes mid-run', async () => {
    const gate = deferred();
    const running = service.runNow({ client: fakeClient({ gate }), bases: [BASE] });
    key = 'acct2';
    expect(service.getOverview([BASE]).bases[0]).toMatchObject({ baseId: BASE.id, restorePointCount: 0 });
    gate.resolve();
    expect((await running).data.results[0].status).toBe('complete');
    key = 'acct1';
    expect(service.getOverview([BASE]).bases[0].restorePointCount).toBe(1);
  });

  it("recovers when another account's backup folder cannot be opened", async () => {
    service.getOverview([BASE]);
    fs.writeFileSync(path.join(root, 'acct2'), 'This is a file, not a backup folder.');
    key = 'acct2';
    expect(() => service.getOverview([BASE])).toThrow(/couldn't open your backups/);
    await expect(service.runNow({ client: fakeClient(), bases: [BASE] })).resolves.toEqual({
      success: false,
      error: expect.stringMatching(/couldn't open your backups/),
    });
    expect(service.isRunning()).toBe(false);

    key = 'acct1';
    expect(service.getOverview([BASE]).bases[0]).toMatchObject({ baseId: BASE.id, restorePointCount: 0 });
  });

  it('explains a failed read in plain words', () => {
    service.getOverview([BASE]);
    service.open().store.close();

    expect(() => service.getOverview([BASE])).toThrow(/couldn't read your backups/);
    expect(() => service.getRestorePoints(BASE.id)).toThrow(/couldn't read your backups/);
  });

  it('blocks sample-data mode while a backup is running', async () => {
    const ctx = createAppContext({
      getActiveAccountId: () => 'acct1',
      switchDatabase: async () => {},
      getBackupRoot: () => root,
    });
    const gate = deferred();
    const running = ctx.backup.runNow({ client: fakeClient({ gate }), bases: [BASE] });
    expect(await ctx.demoMode.enter()).toMatchObject({
      success: false,
      error: expect.stringMatching(/in progress/),
    });
    gate.resolve();
    await running;
    ctx.backup.close();
  });
});
