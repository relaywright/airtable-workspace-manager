/**
 * Fictional demo workspace ("Cedar & Pine Goods") used by demo mode.
 *
 * Loads static fixture JSON (no network, no electron dependency) so it can
 * be required and unit-tested outside of an Electron process.
 */
const fs = require('fs');
const path = require('path');

const DEMO_ACCOUNT_ID = 'demo';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'demo-workspace');

let basesCache = null;
// Maps a known demo base id -> its fixed schema filename. Built once from the
// static bases fixture, never from caller input, so getDemoBaseSchema can
// never be made to build a path from an arbitrary/untrusted baseId (which
// could otherwise escape FIXTURES_DIR via a value like '../../something').
let schemaFileById = null;
const schemaCache = new Map();
const historyCache = new Map();
const recordsCache = new Map();
// attachment id -> file name under fixtures/demo-workspace/files. Built from
// the fixtures themselves, so a caller's id never becomes part of a path.
let fileNameById = null;

const DEMO_FILE_PREFIX = 'demo-file://';
const PAGE_SIZE = 100;

const clone = (value) => JSON.parse(JSON.stringify(value));

function loadBasesFixture() {
  if (!basesCache) {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, 'bases.json'), 'utf8');
    basesCache = JSON.parse(raw);
  }
  return basesCache;
}

function getSchemaFileMap() {
  if (!schemaFileById) {
    schemaFileById = new Map(loadBasesFixture().map((base) => [base.id, `${base.id}.json`]));
  }
  return schemaFileById;
}

/**
 * List the fictional demo bases. Mirrors the shape AirtableClient.listBases()
 * returns (an array of { id, name, permissionLevel }).
 */
function listDemoBases() {
  // Return copies so callers can't mutate the cached fixture data.
  return loadBasesFixture().map((base) => ({ ...base }));
}

/**
 * Get the fictional schema for a demo base. Mirrors the shape
 * AirtableClient.getBaseSchema() returns (Airtable's "get base schema"
 * response: { tables: [...] }).
 * @throws {Error} if baseId isn't one of the known demo bases (this
 * includes any path-traversal-shaped input, e.g. '../bases' or
 * 'appDemoOrders0001/../../x'; the lookup is against a static allowlist,
 * never a path built from the caller's string).
 */
function getDemoBaseSchema(baseId) {
  if (schemaCache.has(baseId)) {
    return JSON.parse(JSON.stringify(schemaCache.get(baseId)));
  }

  const fileName = getSchemaFileMap().get(baseId);
  if (!fileName) {
    throw new Error(`Demo base not found: ${baseId}`);
  }

  const filePath = path.join(FIXTURES_DIR, 'schemas', fileName);
  const raw = fs.readFileSync(filePath, 'utf8');
  const schema = JSON.parse(raw);
  schemaCache.set(baseId, schema);
  return JSON.parse(JSON.stringify(schema));
}

/**
 * Get the recorded schema history for a demo base: an array of
 * { daysAgo, summary, edits } entries (see electron/demoHistory.js), or an
 * empty array when the base has no history file. Uses the same static
 * allowlist as getDemoBaseSchema, so baseId never becomes part of a path.
 * @throws {Error} if baseId isn't one of the known demo bases.
 */
function getDemoBaseHistory(baseId) {
  const fileName = getSchemaFileMap().get(baseId);
  if (!fileName) {
    throw new Error(`Demo base not found: ${baseId}`);
  }

  if (!historyCache.has(baseId)) {
    const filePath = path.join(FIXTURES_DIR, 'history', fileName);
    const changes = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')).changes : [];
    historyCache.set(baseId, changes);
  }
  return JSON.parse(JSON.stringify(historyCache.get(baseId)));
}

function readRecordsFixture(baseId) {
  const fileName = getSchemaFileMap().get(baseId);
  if (!fileName) {
    throw new Error(`Demo base not found: ${baseId}`);
  }
  if (!recordsCache.has(baseId)) {
    const filePath = path.join(FIXTURES_DIR, 'records', fileName);
    const data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
    recordsCache.set(baseId, { tables: data.tables || {}, history: data.history || [] });
  }
  return recordsCache.get(baseId);
}

/**
 * Current demo records for a base plus the forward edits that led to them:
 * { tables: { [tableId]: record[] }, history: [{ daysAgo, summary, edits }] }.
 * Bases without a records fixture return empty tables and history.
 */
function getDemoRecords(baseId) {
  return clone(readRecordsFixture(baseId));
}

/** Ids of the demo bases that have record fixtures (the ones demo backups cover). */
function listDemoRecordBaseIds() {
  return loadBasesFixture()
    .map((base) => base.id)
    .filter((id) => Object.keys(readRecordsFixture(id).tables).length > 0);
}

function collectAttachmentNames(value, into) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (item && typeof item === 'object' && String(item.id).startsWith('att') && item.filename) {
      into.set(item.id, path.basename(item.filename));
    }
  }
}

function getFileNameIndex() {
  if (!fileNameById) {
    fileNameById = new Map();
    for (const baseId of listDemoRecordBaseIds()) {
      const { tables, history } = readRecordsFixture(baseId);
      const records = Object.values(tables).flat();
      for (const change of history) {
        for (const edit of change.edits) {
          if (edit.record) records.push(edit.record);
          if (edit.from) records.push({ fields: edit.from });
        }
      }
      for (const record of records) {
        for (const value of Object.values(record.fields || {})) collectAttachmentNames(value, fileNameById);
      }
    }
  }
  return fileNameById;
}

/** Bytes of a demo attachment, looked up by attachment id. */
function readDemoFile(attachmentId) {
  const fileName = getFileNameIndex().get(attachmentId);
  if (!fileName) {
    throw new Error(`Demo file not found: ${attachmentId}`);
  }
  return fs.readFileSync(path.join(FIXTURES_DIR, 'files', fileName));
}

function demoFileIdFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(DEMO_FILE_PREFIX)) {
    throw new Error('Not a demo file address');
  }
  return url.slice(DEMO_FILE_PREFIX.length);
}

function withDemoFileUrls(record) {
  const copy = clone(record);
  for (const [fieldId, value] of Object.entries(copy.fields || {})) {
    if (Array.isArray(value) && value.some((item) => item && String(item.id).startsWith('att'))) {
      copy.fields[fieldId] = value.map((item) => ({ ...item, url: `${DEMO_FILE_PREFIX}${item.id}` }));
    }
  }
  return copy;
}

/** One page of records in the same shape AirtableClient.listRecords returns. */
function pageRecords(records, offset) {
  const start = offset ? Number(offset) : 0;
  const page = records.slice(start, start + PAGE_SIZE).map(withDemoFileUrls);
  const next = start + PAGE_SIZE < records.length ? String(start + PAGE_SIZE) : undefined;
  return next ? { records: page, offset: next } : { records: page };
}

/**
 * Drop-in replacement for AirtableClient while demo mode is active. Mirrors
 * AirtableClient's public surface used by main.js (listBases, getBaseSchema,
 * fetchSchemasConcurrently, listRecords, downloadFile) so call sites don't need to branch on demo mode.
 */
class DemoAirtableClient {
  async listBases() {
    return listDemoBases();
  }

  async getBaseSchema(baseId) {
    return getDemoBaseSchema(baseId);
  }

  async listRecords(baseId, tableId, { offset } = {}) {
    return pageRecords(readRecordsFixture(baseId).tables[tableId] || [], offset);
  }

  async downloadFile(url) {
    return readDemoFile(demoFileIdFromUrl(url));
  }

  /**
   * Mirrors AirtableClient.fetchSchemasConcurrently's callback contract.
   * There's no network or rate limit to respect here, so bases are just
   * processed in order.
   */
  async fetchSchemasConcurrently(bases, { onProgress, onResult } = {}) {
    const total = bases.length;
    let completed = 0;

    for (const base of bases) {
      try {
        const schema = getDemoBaseSchema(base.id);
        completed++;
        if (onProgress) onProgress(completed, total, base.name);
        if (onResult) onResult(base, schema, null);
      } catch (err) {
        completed++;
        if (onProgress) onProgress(completed, total, base.name);
        if (onResult) onResult(base, null, err);
      }
    }
  }
}

module.exports = {
  DEMO_ACCOUNT_ID,
  listDemoBases,
  getDemoBaseSchema,
  getDemoBaseHistory,
  getDemoRecords,
  listDemoRecordBaseIds,
  readDemoFile,
  demoFileIdFromUrl,
  pageRecords,
  DemoAirtableClient,
};
