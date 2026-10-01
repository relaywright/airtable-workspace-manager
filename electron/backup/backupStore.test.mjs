import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { openBackupStore } = require('./backupStore.js');
const { createFileStore } = require('./fileStore.js');

const BASE_ID = 'appTestStore00001';
const TABLE_ID = 'tblTestStore00001';
const RECORD_ID = 'recTestStore00001';
const COUNTS = { records: 1, created: 1, changed: 0, deleted: 0, filesSaved: 0, filesFailed: 0 };

describe('backup store', () => {
  let dir;

  beforeEach(() => {
    // A space and a non-ASCII letter, like many Windows user folders.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm backup é-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("closes the database when an old backup file can't be opened", () => {
    const db = new Database(path.join(dir, 'backup.db'));
    db.exec('CREATE TABLE backup_runs (id INTEGER PRIMARY KEY, base_id TEXT)');
    db.close();

    expect(() => openBackupStore(dir)).toThrow();
    expect(() => fs.rmSync(dir, { recursive: true, force: true })).not.toThrow();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('discards a backup the app never finished and keeps earlier restore points', () => {
    const store = openBackupStore(dir);
    const event = (value) => ({
      recordId: RECORD_ID,
      kind: 'created',
      fieldsJson: JSON.stringify({ fldTestStore00001: value }),
      fingerprint: value,
      createdTime: '2026-09-01T12:00:00.000Z',
    });

    const finished = store.startRun({
      baseId: BASE_ID,
      baseName: 'Store',
      startedAt: '2026-09-25T10:00:00.000Z',
    });
    store.writeEvents(finished, BASE_ID, TABLE_ID, [event('first')]);
    store.completeRun(finished, { finishedAt: '2026-09-25T10:00:05.000Z', counts: COUNTS });

    const cutShort = store.startRun({
      baseId: BASE_ID,
      baseName: 'Store',
      startedAt: '2026-09-26T10:00:00.000Z',
    });
    store.writeEvents(cutShort, BASE_ID, TABLE_ID, [{ ...event('second'), kind: 'changed' }]);
    store.close(); // the app quits mid-run

    const reopened = openBackupStore(dir);
    const discarded = reopened.discardInterruptedRuns('2026-09-26T11:00:00.000Z');
    expect(discarded.map((r) => r.id)).toEqual([cutShort]);
    expect(reopened.getRunEvents(cutShort)).toEqual([]);
    expect(reopened.getRun(cutShort)).toMatchObject({ status: 'incomplete', error: { code: 'interrupted' } });
    expect(reopened.listRestorePoints(BASE_ID).map((r) => r.id)).toEqual([finished]);
    expect(reopened.getRecordsAsOf(BASE_ID, TABLE_ID, finished)).toEqual([
      { id: RECORD_ID, createdTime: '2026-09-01T12:00:00.000Z', fields: { fldTestStore00001: 'first' } },
    ]);
    expect(reopened.getLatestVersions(BASE_ID, TABLE_ID).get(RECORD_ID)).toEqual({
      kind: 'created',
      fingerprint: 'first',
    });
    reopened.close();
  });

  it('ignores records from a backup that never finished', () => {
    const store = openBackupStore(dir);
    const event = (value) => ({
      recordId: RECORD_ID,
      kind: 'created',
      fieldsJson: JSON.stringify({ fldTestStore00001: value }),
      fingerprint: value,
      createdTime: '2026-09-01T12:00:00.000Z',
    });

    const run1Id = store.startRun({
      baseId: BASE_ID,
      baseName: 'Store',
      startedAt: '2026-09-25T10:00:00.000Z',
    });
    store.writeEvents(run1Id, BASE_ID, TABLE_ID, [event('A')]);
    store.completeRun(run1Id, { finishedAt: '2026-09-25T10:00:05.000Z', counts: COUNTS });

    const run2Id = store.startRun({
      baseId: BASE_ID,
      baseName: 'Store',
      startedAt: '2026-09-26T10:00:00.000Z',
    });
    store.writeEvents(run2Id, BASE_ID, TABLE_ID, [
      { ...event('B'), kind: 'changed' },
      { ...event('B'), recordId: 'recTestStore00002' },
    ]);
    expect(store.getLatestVersions(BASE_ID, TABLE_ID)).toEqual(
      new Map([[RECORD_ID, { kind: 'created', fingerprint: 'A' }]]),
    );

    const run3Id = store.startRun({
      baseId: BASE_ID,
      baseName: 'Store',
      startedAt: '2026-09-26T11:00:00.000Z',
    });
    store.completeRun(run3Id, {
      finishedAt: '2026-09-26T11:00:05.000Z',
      counts: { ...COUNTS, created: 0 },
    });
    expect(store.getRecordsAsOf(BASE_ID, TABLE_ID, run3Id)).toEqual([
      { id: RECORD_ID, createdTime: '2026-09-01T12:00:00.000Z', fields: { fldTestStore00001: 'A' } },
    ]);
    store.close();
  });

  it('stores identical file contents once', () => {
    const files = createFileStore(dir);
    const first = files.save(Buffer.from('same bytes'));
    const second = files.save(Buffer.from('same bytes'));
    expect(first.alreadyStored).toBe(false);
    expect(second).toEqual({ hash: first.hash, size: 10, alreadyStored: true });
    expect(files.has(first.hash)).toBe(true);
    expect(fs.readdirSync(path.dirname(files.pathFor(first.hash)))).toEqual([first.hash]);
  });
});
