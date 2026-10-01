import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  listDemoBases,
  listDemoRecordBaseIds,
  getDemoBaseSchema,
  getDemoRecords,
  readDemoFile,
  DemoAirtableClient,
} = require('./demoWorkspace.js');
const { buildDemoVersions, seedDemoBackups } = require('./demoBackups.js');
const { openBackupStore } = require('./backup/backupStore.js');
const { createFileStore } = require('./backup/fileStore.js');
const { runBackup } = require('./backup/backupEngine.js');

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
const ATTACHMENT_ID = /^att[A-Za-z0-9]{14}$/;
const COMPUTED = new Set([
  'formula',
  'multipleLookupValues',
  'rollup',
  'count',
  'createdTime',
  'lastModifiedTime',
]);

// For a link field A -> B, the reverse field is B's only field linking back to A's table.
function reverseLinkField(schema, table, field) {
  const target = schema.tables.find((t) => t.id === field.options.linkedTableId);
  const back = target.fields.filter(
    (f) => f.type === 'multipleRecordLinks' && f.options.linkedTableId === table.id,
  );
  return back.length === 1 ? { target, field: back[0] } : null;
}

function expectVersionFitsSchema(baseId, tables, label) {
  const schema = getDemoBaseSchema(baseId);
  const byId = (tableId) => new Map((tables[tableId] || []).map((r) => [r.id, r]));
  for (const [tableId, records] of Object.entries(tables)) {
    const table = schema.tables.find((t) => t.id === tableId);
    expect(table, `${label}: unknown table ${tableId}`).toBeTruthy();
    const ids = new Set();
    for (const record of records) {
      expect(record.id, label).toMatch(RECORD_ID);
      expect(ids.has(record.id), `${label}: duplicate ${record.id}`).toBe(false);
      ids.add(record.id);
      expect(Number.isNaN(Date.parse(record.createdTime)), `${label}: createdTime`).toBe(false);
      for (const [fieldId, value] of Object.entries(record.fields)) {
        const field = table.fields.find((f) => f.id === fieldId);
        expect(field, `${label}: ${record.id} has unknown field ${fieldId}`).toBeTruthy();
        const choices = field.options?.choices?.map((c) => c.name);
        if (field.type === 'singleSelect' && choices) expect(choices, label).toContain(value);
        if (field.type === 'multipleSelects' && choices)
          value.forEach((v) => expect(choices, label).toContain(v));
        if (field.type === 'email') expect(value, label).toMatch(/@example\.com$/);
        if (
          ['singleCollaborator', 'multipleCollaborators', 'createdBy', 'lastModifiedBy'].includes(field.type)
        ) {
          throw new Error(`${label}: leave collaborator fields empty (${field.name})`);
        }
        if (field.type === 'multipleAttachments') {
          for (const attachment of value) {
            expect(attachment.id, label).toMatch(ATTACHMENT_ID);
            expect(readDemoFile(attachment.id).length, `${label}: size of ${attachment.filename}`).toBe(
              attachment.size,
            );
          }
        }
        if (field.type === 'multipleRecordLinks') {
          const targets = byId(field.options.linkedTableId);
          const reverse = reverseLinkField(schema, table, field);
          for (const linkedId of value) {
            expect(targets.has(linkedId), `${label}: ${record.id} links to missing ${linkedId}`).toBe(true);
            if (reverse) {
              const back = targets.get(linkedId).fields[reverse.field.id] || [];
              expect(back, `${label}: ${linkedId} does not link back to ${record.id}`).toContain(record.id);
            }
          }
        }
        if (COMPUTED.has(field.type) && field.type !== 'formula') {
          throw new Error(
            `${label}: only formula values may be filled in among computed fields (${field.name})`,
          );
        }
      }
    }
  }
}

describe('demo records', () => {
  it('has records for the three demo bases chosen for backups', () => {
    expect(listDemoRecordBaseIds().sort()).toEqual([
      'appDemoOrders0001',
      'appDemoProduct001',
      'appDemoSupplier01',
    ]);
  });

  it('fits the demo schemas in every version of its history', () => {
    for (const baseId of listDemoRecordBaseIds()) {
      const versions = buildDemoVersions(baseId);
      expect(versions).toHaveLength(getDemoRecords(baseId).history.length + 2);
      versions.forEach((v) => expectVersionFitsSchema(baseId, v.tables, `${baseId} ${v.daysAgo} days ago`));
    }
  });
});

describe('demo restore points', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-demo-backups-'));
    store = openBackupStore(dir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('seeds a restore point per version, with added, changed and deleted records along the way', async () => {
    const files = createFileStore(dir);
    await seedDemoBackups({ store, files, now: new Date('2026-09-26T12:00:00.000Z') });

    const totals = { created: 0, changed: 0, deleted: 0 };
    for (const baseId of listDemoRecordBaseIds()) {
      const points = store.listRestorePoints(baseId);
      expect(points).toHaveLength(getDemoRecords(baseId).history.length + 2);
      points.slice(0, -1).forEach((p) => {
        totals.created += p.counts.created;
        totals.changed += p.counts.changed;
        totals.deleted += p.counts.deleted;
      });
      const current = Object.values(getDemoRecords(baseId).tables).flat().length;
      expect(store.getBaseSummary(baseId).recordCount).toBe(current);
      expect(points[0].startedAt < '2026-09-26T12:00:00.000Z').toBe(true);
    }
    expect(totals.created).toBeGreaterThan(0);
    expect(totals.changed).toBeGreaterThan(0);
    expect(totals.deleted).toBeGreaterThan(0);
  });

  it('adds a no-change restore point when Back up now runs on the demo', async () => {
    const files = createFileStore(dir);
    await seedDemoBackups({ store, files });
    const bases = listDemoBases().filter((b) => listDemoRecordBaseIds().includes(b.id));
    const results = await runBackup({ client: new DemoAirtableClient(), store, files, bases });
    for (const result of results) {
      expect(result).toMatchObject({ status: 'complete', counts: { created: 0, changed: 0, deleted: 0 } });
    }
  });
});
