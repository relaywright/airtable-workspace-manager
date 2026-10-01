/**
 * Seeded schema history for the demo workspace.
 *
 * Each file in fixtures/demo-workspace/history/ lists a base's recent schema
 * changes as forward edits, where the newest version is the base's current
 * schema fixture. Undoing those edits one change at a time rebuilds every
 * earlier version, which is exactly what a real refresh would have stored:
 * refresh.js saves the OLD schema as a snapshot whenever it detects a change.
 * Seeding those versions, backdated, gives the Change Log, per-base History,
 * and Health screens a few weeks of believable activity.
 *
 * Does not require `electron`, so it can be tested against a plain database.
 */
const { listDemoBases, getDemoBaseSchema, getDemoBaseHistory } = require('./demoWorkspace');

const DAY_MS = 86400000;

const clone = (value) => JSON.parse(JSON.stringify(value));

function findField(schema, fieldId) {
  for (const table of schema.tables) {
    const index = table.fields.findIndex((f) => f.id === fieldId);
    if (index >= 0) return { table, index };
  }
  throw new Error(`Demo history: field ${fieldId} not found`);
}

function findTableIndex(schema, tableId) {
  const index = schema.tables.findIndex((t) => t.id === tableId);
  if (index < 0) throw new Error(`Demo history: table ${tableId} not found`);
  return index;
}

// Each entry undoes one forward edit, turning `schema` into the version before it.
const UNDO = {
  addField(schema, edit) {
    const { table, index } = findField(schema, edit.fieldId);
    table.fields.splice(index, 1);
  },
  removeField(schema, edit) {
    schema.tables[findTableIndex(schema, edit.tableId)].fields.push(clone(edit.field));
  },
  modifyField(schema, edit) {
    const { table, index } = findField(schema, edit.fieldId);
    Object.assign(table.fields[index], clone(edit.from));
  },
  addTable(schema, edit) {
    schema.tables.splice(findTableIndex(schema, edit.tableId), 1);
  },
  removeTable(schema, edit) {
    schema.tables.push(clone(edit.table));
  },
  renameTable(schema, edit) {
    schema.tables[findTableIndex(schema, edit.tableId)].name = edit.from;
  },
};

/**
 * Return the schema as it was before `change` happened.
 * @throws {Error} on an unknown edit op or an edit that points at a missing table/field.
 */
function revertChange(schema, change) {
  const previous = clone(schema);
  for (const edit of [...change.edits].reverse()) {
    const undo = UNDO[edit.op];
    if (!undo) throw new Error(`Demo history: unknown edit op "${edit.op}"`);
    undo(previous, edit);
  }
  return previous;
}

// Same text format SQLite's datetime('now') default writes (UTC, no "T" or
// "Z"), so seeded rows sort and display exactly like snapshots a real refresh saved.
function toSqliteTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Build every backdated snapshot the demo history describes.
 * @param {number} now - epoch ms that `daysAgo` counts back from.
 * @returns {Array<{ baseId: string, schemaJson: string, pulledAt: string }>}
 */
function buildDemoSnapshots(now) {
  const snapshots = [];
  for (const { id: baseId } of listDemoBases()) {
    // Newest change first: each revert steps one version further back.
    const changes = getDemoBaseHistory(baseId).sort((a, b) => a.daysAgo - b.daysAgo);
    let schema = getDemoBaseSchema(baseId);
    for (const change of changes) {
      schema = revertChange(schema, change);
      // Spread changes across the working day instead of stamping them all at
      // the current clock time. Always under a day, so per-base order holds.
      const timeOfDayOffset = ((change.daysAgo * 97) % 360) * 60000;
      snapshots.push({
        baseId,
        schemaJson: JSON.stringify(schema),
        pulledAt: toSqliteTimestamp(now - change.daysAgo * DAY_MS - timeOfDayOffset),
      });
    }
  }
  return snapshots;
}

/**
 * Seed the open database with the demo workspace's schema history. Does
 * nothing if the database already has any snapshots, so re-entering demo
 * mode never duplicates rows. Only call this with the demo database open
 * (enter-demo-mode does, right after switching to it and refreshing).
 * @param {import('./database').database} database
 * @param {{ now?: number }} [options]
 * @returns {{ seeded: number }}
 */
function seedDemoHistory(database, { now = Date.now() } = {}) {
  if (database.getAllSnapshots(1).length > 0) {
    return { seeded: 0 };
  }

  // Snapshots reference bases(id), so skip any base the refresh didn't store.
  const snapshots = buildDemoSnapshots(now).filter((s) => database.getBase(s.baseId));

  database.beginBatch();
  try {
    for (const s of snapshots) {
      database.createSnapshot(s.baseId, s.schemaJson, s.pulledAt);
    }
    database.endBatch();
  } catch (err) {
    database.rollbackBatch();
    throw err;
  }
  return { seeded: snapshots.length };
}

module.exports = { seedDemoHistory };
