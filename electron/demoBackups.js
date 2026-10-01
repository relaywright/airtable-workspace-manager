/**
 * Seeded backup history for the demo workspace.
 *
 * Each records fixture holds a base's current records plus the forward edits
 * that produced them. Undoing those edits one change at a time rebuilds every
 * earlier version; backing each version up with the real engine, at the time
 * it existed, gives the Backups view a few weeks of believable restore points
 * (records added, edited, and deleted) without a token.
 *
 * Does not require('electron').
 */
const {
  listDemoBases,
  listDemoRecordBaseIds,
  getDemoBaseSchema,
  getDemoRecords,
  pageRecords,
  readDemoFile,
  demoFileIdFromUrl,
} = require('./demoWorkspace');
const { runBaseBackup } = require('./backup/backupEngine');

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const BASELINE_DAYS_BEFORE_FIRST_CHANGE = 7;

const clone = (value) => JSON.parse(JSON.stringify(value));

function findRecord(tables, tableId, recordId) {
  const record = (tables[tableId] || []).find((r) => r.id === recordId);
  if (!record) throw new Error(`Demo record history: ${recordId} not found in ${tableId}`);
  return record;
}

// Each entry undoes one forward edit.
const UNDO = {
  create(tables, edit) {
    findRecord(tables, edit.tableId, edit.recordId);
    tables[edit.tableId] = tables[edit.tableId].filter((r) => r.id !== edit.recordId);
  },
  update(tables, edit) {
    const record = findRecord(tables, edit.tableId, edit.recordId);
    for (const [fieldId, value] of Object.entries(edit.from)) {
      if (value === null) delete record.fields[fieldId];
      else record.fields[fieldId] = clone(value);
    }
  },
  delete(tables, edit) {
    tables[edit.tableId] ||= [];
    tables[edit.tableId].push(clone(edit.record));
  },
};

/**
 * Every version of a demo base's records, oldest first: a baseline a week
 * before the first change, one version per change, and today's.
 */
function buildDemoVersions(baseId) {
  const { tables, history } = getDemoRecords(baseId);
  const newestFirst = [...history].sort((a, b) => a.daysAgo - b.daysAgo);
  const versions = [{ daysAgo: 0, tables: clone(tables) }];
  let state = clone(tables);
  for (const change of newestFirst) {
    versions.push({ daysAgo: change.daysAgo, tables: clone(state) });
    for (const edit of [...change.edits].reverse()) {
      const undo = UNDO[edit.op];
      if (!undo) throw new Error(`Demo record history: unknown edit "${edit.op}"`);
      undo(state, edit);
    }
  }
  const oldest = newestFirst.length ? newestFirst[newestFirst.length - 1].daysAgo : 0;
  versions.push({ daysAgo: oldest + BASELINE_DAYS_BEFORE_FIRST_CHANGE, tables: state });
  return versions.reverse();
}

async function seedDemoBackups({ store, files, now = new Date() }) {
  for (const baseId of listDemoRecordBaseIds()) {
    const base = listDemoBases().find((b) => b.id === baseId);
    const schema = getDemoBaseSchema(baseId);
    for (const version of buildDemoVersions(baseId)) {
      const at = new Date(now.getTime() - version.daysAgo * DAY_MS - 2 * HOUR_MS);
      const client = {
        getBaseSchema: async () => schema,
        listRecords: async (_baseId, tableId, { offset } = {}) =>
          pageRecords(version.tables[tableId] || [], offset),
        downloadFile: async (url) => readDemoFile(demoFileIdFromUrl(url)),
      };
      const result = await runBaseBackup({ client, store, files, base, trigger: 'scheduled', now: () => at });
      if (result.status !== 'complete') {
        throw new Error(`Demo backup history failed for ${base.name}: ${result.error?.message}`);
      }
    }
  }
}

module.exports = { buildDemoVersions, seedDemoBackups };
