import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { startFakeAirtable } from '../../test/fakeAirtable.mjs';

const require = createRequire(import.meta.url);
const { AirtableClient } = require('../airtableClient.js');
const { openBackupStore } = require('./backupStore.js');
const { createFileStore } = require('./fileStore.js');
const { runBaseBackup } = require('./backupEngine.js');
const { sha256 } = require('./recordFingerprint.js');

const BASE = { id: 'appTestBackup0001', name: 'Test Shop' };
const PRODUCTS = 'tblTestProducts01';
const NOTES = 'tblTestNotes00001';
const EMPTY = 'tblTestEmpty00001';
const F = {
  name: 'fldTestName000001',
  price: 'fldTestPrice00001',
  photos: 'fldTestPhotos0001',
  margin: 'fldTestMargin0001',
  note: 'fldTestNote000001',
  product: 'fldTestProduct001',
  extra: 'fldTestExtra00001',
};
const CREATED = '2026-09-01T12:00:00.000Z';
const PHOTO_A = { id: 'attTestPhotoA0001', filename: 'front.jpg', type: 'image/jpeg', size: 10 };
const PHOTO_B = { id: 'attTestPhotoB0001', filename: 'front-copy.jpg', type: 'image/jpeg', size: 10 };
const PHOTO_C = { id: 'attTestPhotoC0001', filename: 'side.jpg', type: 'image/jpeg', size: 11 };
const PHOTO_D = { id: 'attTestPhotoD0001', filename: 'back.jpg', type: 'image/jpeg', size: 9 };

const productId = (n) => `recTestProd${String(n).padStart(6, '0')}`;
const noteId = (n) => `recTestNote${String(n).padStart(6, '0')}`;

function product(n, extra = {}) {
  return {
    id: productId(n),
    createdTime: CREATED,
    fields: { [F.name]: `Product ${n}`, [F.price]: 10 + n, [F.margin]: 0.4, ...extra },
  };
}

function schema() {
  return {
    tables: [
      {
        id: PRODUCTS,
        name: 'Products',
        fields: [
          { id: F.name, name: 'Name', type: 'singleLineText' },
          { id: F.price, name: 'Price', type: 'currency' },
          { id: F.photos, name: 'Photos', type: 'multipleAttachments' },
          { id: F.margin, name: 'Margin', type: 'formula' },
        ],
      },
      {
        id: NOTES,
        name: 'Notes',
        fields: [
          { id: F.note, name: 'Note', type: 'multilineText' },
          {
            id: F.product,
            name: 'Product',
            type: 'multipleRecordLinks',
            options: { linkedTableId: PRODUCTS },
          },
        ],
      },
      {
        id: EMPTY,
        name: 'Empty',
        fields: [{ id: 'fldTestEmptyName1', name: 'Name', type: 'singleLineText' }],
      },
    ],
  };
}

function workspace({ productCount } = {}) {
  const products = productCount
    ? Array.from({ length: productCount }, (_, i) => product(i + 1))
    : [
        product(1, { [F.photos]: [PHOTO_A] }),
        product(2, { [F.photos]: [PHOTO_B] }),
        product(3, { [F.photos]: [PHOTO_C] }),
      ];
  return {
    bases: [{ ...BASE, permissionLevel: 'create' }],
    schemas: { [BASE.id]: schema() },
    records: {
      [BASE.id]: {
        [PRODUCTS]: products,
        [NOTES]: [
          {
            id: noteId(1),
            createdTime: CREATED,
            fields: { [F.note]: 'Note 1', [F.product]: [productId(1)] },
          },
        ],
      },
    },
    files: {
      [PHOTO_A.id]: Buffer.from('same-bytes'),
      [PHOTO_B.id]: Buffer.from('same-bytes'),
      [PHOTO_C.id]: Buffer.from('other-bytes'),
      [PHOTO_D.id]: Buffer.from('new-bytes'),
    },
  };
}

function storedFileCount(root) {
  if (!fs.existsSync(root)) return 0;
  return fs.readdirSync(root).reduce((n, shard) => n + fs.readdirSync(path.join(root, shard)).length, 0);
}

describe('backup engine', () => {
  let dir;
  let fake;
  let client;
  let store;
  let files;

  async function start(options, data = workspace(options)) {
    fake = await startFakeAirtable(data);
    client = new AirtableClient('test-token', { baseUrl: fake.apiUrl, fileOrigins: [fake.url] });
    // No waiting in tests: with sleep stubbed out, the 5-per-second limiter
    // would busy-spin instead of pausing, so lift it too.
    client.sleep = async () => {};
    client.maxRequestsPerSecond = Infinity;
  }

  const backup = (overrides = {}) => runBaseBackup({ client, store, files, base: BASE, ...overrides });
  const pointIds = () => store.listRestorePoints(BASE.id).map((r) => r.id);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-engine-'));
    store = openBackupStore(dir);
    files = createFileStore(dir);
  });

  afterEach(async () => {
    store.close();
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stores every record as created on the first run, including an empty table', async () => {
    await start();
    const run = await backup();
    expect(run).toMatchObject({
      status: 'complete',
      counts: { records: 4, created: 4, changed: 0, deleted: 0 },
    });
    expect(store.getRunEvents(run.runId).map((e) => e.kind)).toEqual([
      'created',
      'created',
      'created',
      'created',
    ]);
    expect(pointIds()).toEqual([run.runId]);
  });

  it('writes zero events when nothing editable changed, even with fresh file URLs and a new formula value', async () => {
    await start();
    await backup();
    fake.advanceClock(60 * 60 * 1000); // every attachment URL is different now
    fake.updateRecord(BASE.id, PRODUCTS, productId(1), { [F.margin]: 0.9 }); // computed field only
    const second = await backup();
    expect(second.status).toBe('complete');
    expect(store.getRunEvents(second.runId)).toEqual([]);
    expect(pointIds()).toHaveLength(2);
  });

  it('writes exactly one changed event for one edited field', async () => {
    await start();
    await backup();
    fake.updateRecord(BASE.id, PRODUCTS, productId(2), { [F.price]: 99 });
    const second = await backup();
    expect(store.getRunEvents(second.runId)).toEqual([
      { tableId: PRODUCTS, recordId: productId(2), kind: 'changed' },
    ]);
  });

  it('marks a missing record deleted, and records it as created again if it comes back', async () => {
    await start();
    await backup();
    const removed = product(2, { [F.photos]: [PHOTO_B] });
    fake.removeRecord(BASE.id, PRODUCTS, productId(2));
    const second = await backup();
    expect(store.getRunEvents(second.runId)).toEqual([
      { tableId: PRODUCTS, recordId: productId(2), kind: 'deleted' },
    ]);
    fake.addRecord(BASE.id, PRODUCTS, removed);
    const third = await backup();
    expect(store.getRunEvents(third.runId)).toEqual([
      { tableId: PRODUCTS, recordId: productId(2), kind: 'created' },
    ]);
  });

  it('marks nothing deleted when a table fails mid-fetch, and the run is not a restore point', async () => {
    await start({ productCount: 150 });
    const first = await backup();
    fake.removeRecord(BASE.id, PRODUCTS, productId(5));
    fake.addFault({ path: 'offset=itr100', kind: 'drop', times: Infinity });

    const failed = await backup();
    expect(failed.status).toBe('incomplete');
    expect(failed.error.code).toBe('network');
    expect(store.getRunEvents(failed.runId)).toEqual([]);
    expect(pointIds()).toEqual([first.runId]);

    fake.clearFaults();
    const recovered = await backup();
    expect(store.getRunEvents(recovered.runId)).toEqual([
      { tableId: PRODUCTS, recordId: productId(5), kind: 'deleted' },
    ]);
  });

  it('rebuilds each restore point exactly as the base looked then', async () => {
    await start();
    const photo = (att) => [att];
    const run1 = await backup();
    fake.updateRecord(BASE.id, PRODUCTS, productId(1), { [F.price]: 99 });
    fake.removeRecord(BASE.id, PRODUCTS, productId(2));
    fake.addRecord(BASE.id, PRODUCTS, product(4));
    const run2 = await backup();
    fake.updateRecord(BASE.id, PRODUCTS, productId(1), { [F.price]: 120 });
    fake.removeRecord(BASE.id, PRODUCTS, productId(3));
    const run3 = await backup();

    const row = (n, fields) => ({ id: productId(n), createdTime: CREATED, fields });
    const base = (n, extra) => ({ [F.name]: `Product ${n}`, [F.margin]: 0.4, ...extra });
    expect(store.getRecordsAsOf(BASE.id, PRODUCTS, run1.runId)).toEqual([
      row(1, base(1, { [F.price]: 11, [F.photos]: photo(PHOTO_A) })),
      row(2, base(2, { [F.price]: 12, [F.photos]: photo(PHOTO_B) })),
      row(3, base(3, { [F.price]: 13, [F.photos]: photo(PHOTO_C) })),
    ]);
    expect(store.getRecordsAsOf(BASE.id, PRODUCTS, run2.runId)).toEqual([
      row(1, base(1, { [F.price]: 99, [F.photos]: photo(PHOTO_A) })),
      row(3, base(3, { [F.price]: 13, [F.photos]: photo(PHOTO_C) })),
      row(4, base(4, { [F.price]: 14 })),
    ]);
    expect(store.getRecordsAsOf(BASE.id, PRODUCTS, run3.runId)).toEqual([
      row(1, base(1, { [F.price]: 120, [F.photos]: photo(PHOTO_A) })),
      row(4, base(4, { [F.price]: 14 })),
    ]);
  });

  it('stores identical attachment files once', async () => {
    await start();
    const run = await backup();
    expect(run.counts.filesSaved).toBe(3);
    expect(storedFileCount(files.root)).toBe(2); // PHOTO_A and PHOTO_B have the same bytes
    expect(store.getBaseSummary(BASE.id)).toMatchObject({ fileCount: 3, fileBytes: 31 });
  });

  it('backs up files in a new field or shown only through a lookup, and never stores signed links', async () => {
    const data = workspace({ productCount: 1 });
    const lookupField = 'fldTestLookup001';
    data.schemas[BASE.id].tables[0].fields.push({
      id: lookupField,
      name: 'Photo lookup',
      type: 'multipleLookupValues',
    });
    data.records[BASE.id][PRODUCTS][0].fields[F.extra] = [PHOTO_D];
    data.records[BASE.id][PRODUCTS][0].fields[lookupField] = [PHOTO_A];
    await start(undefined, data);

    const run = await backup();
    expect(run).toMatchObject({ status: 'complete', counts: { filesSaved: 2, filesFailed: 0 } });
    expect(store.hasAttachment(PHOTO_A.id)).toBe(true);
    expect(store.hasAttachment(PHOTO_D.id)).toBe(true);
    expect(files.has(sha256('new-bytes'))).toBe(true);
    expect(storedFileCount(files.root)).toBe(2);
    expect(fake.requests.some((request) => request.path.startsWith(`/files/${PHOTO_A.id}`))).toBe(true);

    const saved = store.getRecordsAsOf(BASE.id, PRODUCTS, run.runId)[0];
    expect(saved.fields[F.extra]).toEqual([PHOTO_D]);
    expect(saved.fields[lookupField]).toEqual([PHOTO_A]);
    for (const table of data.schemas[BASE.id].tables) {
      const records = store.getRecordsAsOf(BASE.id, table.id, run.runId);
      for (const record of records) expect(JSON.stringify(record.fields)).not.toContain('"url"');
    }
  });

  it('keeps going after a single rate limit response', async () => {
    await start();
    fake.addFault({ path: `/v0/${BASE.id}/${PRODUCTS}`, kind: 'rate-limit', times: 1 });
    const run = await backup();
    expect(run.status).toBe('complete');
    expect(fake.requests.filter((r) => r.path.startsWith(`/v0/${BASE.id}/${PRODUCTS}`)).length).toBe(2);
  });

  it('says Airtable asked to slow down when every retry is rate limited', async () => {
    await start();
    fake.addFault({ path: `/v0/${BASE.id}/${PRODUCTS}`, kind: 'rate-limit', times: Infinity });
    const run = await backup();
    expect(run).toMatchObject({ status: 'incomplete', error: { code: 'rate-limited' } });
    expect(pointIds()).toEqual([]);
  });

  it('explains a full disk even when the run cannot be recorded at all', async () => {
    await start();
    const fullStore = {
      ...store,
      startRun() {
        throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
      },
    };
    const run = await backup({ store: fullStore });
    expect(run).toMatchObject({ runId: null, status: 'incomplete', error: { code: 'disk-full' } });
  });

  it('reports expired file links without failing the run, and saves the files next time', async () => {
    await start();
    fake.setUrlLifetime(-1); // every link is already expired
    const first = await backup();
    expect(first).toMatchObject({ status: 'complete', counts: { filesSaved: 0, filesFailed: 3 } });
    fake.setUrlLifetime(2 * 60 * 60 * 1000);
    const second = await backup();
    expect(second.counts).toMatchObject({ filesSaved: 3, filesFailed: 0 });
  });

  it('stops cleanly when the disk is full and keeps earlier restore points valid', async () => {
    await start();
    const first = await backup();
    const before = store.getRecordsAsOf(BASE.id, PRODUCTS, first.runId);
    fake.updateRecord(BASE.id, PRODUCTS, productId(1), { [F.photos]: [PHOTO_A, PHOTO_D] });
    const fullDisk = {
      ...fs,
      writeFileSync() {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      },
    };

    const failed = await backup({ files: createFileStore(dir, { fsImpl: fullDisk }) });
    expect(failed.status).toBe('incomplete');
    expect(failed.error.code).toBe('disk-full');
    expect(failed.error.message).toMatch(/at least \d+ MB/);
    expect(pointIds()).toEqual([first.runId]);
    expect(store.getRecordsAsOf(BASE.id, PRODUCTS, first.runId)).toEqual(before);
  });

  it('explains a token that cannot read records, with a link to the token page', async () => {
    await start();
    fake.addFault({ path: `/v0/${BASE.id}/${PRODUCTS}`, kind: 'forbidden', times: 1 });
    const run = await backup();
    expect(run.status).toBe('incomplete');
    expect(run.error).toMatchObject({ code: 'missing-scope', helpUrl: 'https://airtable.com/create/tokens' });
    expect(run.error.message).toContain('data.records:read');
    expect(pointIds()).toEqual([]);
  });

  it('saves a field the schema did not list', async () => {
    await start();
    fake.updateRecord(BASE.id, PRODUCTS, productId(3), { [F.extra]: 'added a moment ago' });
    const run = await backup();
    expect(run.status).toBe('complete');
    const saved = store.getRecordsAsOf(BASE.id, PRODUCTS, run.runId).find((r) => r.id === productId(3));
    expect(saved.fields[F.extra]).toBe('added a moment ago');
  });
});
