/**
 * Backup storage: one SQLite file per backup folder holding every backup run
 * and every record version as an append-only event log.
 *
 * A record's state "as of" a run is its latest event at or before that run;
 * a `deleted` event means it did not exist then. Unchanged records write
 * nothing. Runs of one base never overlap (the backup service allows one run
 * at a time), so a higher event id is always a later version.
 *
 * Does not require('electron'), so tests can open it in a temp folder.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { sha256, stableStringify } = require('./recordFingerprint');

const INTERRUPTED_ERROR = {
  code: 'interrupted',
  message:
    'This backup was cut short when the app closed. Nothing from it was kept, and your earlier restore points are unchanged. The next backup will catch up.',
};

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    schema_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_schema_versions_base ON schema_versions(base_id, id);

  CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_id TEXT NOT NULL,
    base_name TEXT NOT NULL,
    run_trigger TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'incomplete')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    schema_version_id INTEGER REFERENCES schema_versions(id),
    records_seen INTEGER NOT NULL DEFAULT 0,
    created_count INTEGER NOT NULL DEFAULT 0,
    changed_count INTEGER NOT NULL DEFAULT 0,
    deleted_count INTEGER NOT NULL DEFAULT 0,
    files_saved INTEGER NOT NULL DEFAULT 0,
    files_failed INTEGER NOT NULL DEFAULT 0,
    error_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_backup_runs_base ON backup_runs(base_id, id);

  CREATE TABLE IF NOT EXISTS record_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES backup_runs(id),
    base_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('created', 'changed', 'deleted')),
    fields_json TEXT,
    fingerprint TEXT,
    created_time TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_record_events_lookup ON record_events(base_id, table_id, record_id, id);
  CREATE INDEX IF NOT EXISTS idx_record_events_run ON record_events(run_id);

  CREATE TABLE IF NOT EXISTS attachments (
    attachment_id TEXT PRIMARY KEY,
    base_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    filename TEXT,
    type TEXT,
    size INTEGER NOT NULL,
    first_run_id INTEGER NOT NULL,
    saved_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_base ON attachments(base_id);
`;

function parseError(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { code: 'unknown', message: String(text) };
  }
}

function toRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    baseId: row.base_id,
    baseName: row.base_name,
    trigger: row.run_trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: {
      records: row.records_seen,
      created: row.created_count,
      changed: row.changed_count,
      deleted: row.deleted_count,
      filesSaved: row.files_saved,
      filesFailed: row.files_failed,
    },
    error: parseError(row.error_json),
  };
}

function openBackupStore(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const db = new Database(path.join(folder, 'backup.db'));
  try {
    return createStore(db, folder);
  } catch (err) {
    db.close();
    throw err;
  }
}

function createStore(db, folder) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  const insertEvent = db.prepare(`
    INSERT INTO record_events (run_id, base_id, table_id, record_id, kind, fields_json, fingerprint, created_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRunEnd = db.prepare(`
    UPDATE backup_runs
    SET status = ?, finished_at = ?, records_seen = ?, created_count = ?, changed_count = ?,
        deleted_count = ?, files_saved = ?, files_failed = ?, error_json = ?
    WHERE id = ?
  `);
  const deleteRunEvents = db.prepare('DELETE FROM record_events WHERE run_id = ?');

  function endRun(runId, status, finishedAt, counts, error) {
    updateRunEnd.run(
      status,
      finishedAt,
      counts.records,
      counts.created,
      counts.changed,
      counts.deleted,
      counts.filesSaved,
      counts.filesFailed,
      error ? JSON.stringify(error) : null,
      runId,
    );
  }

  const writeEvents = db.transaction((runId, baseId, tableId, events) => {
    for (const event of events) {
      insertEvent.run(
        runId,
        baseId,
        tableId,
        event.recordId,
        event.kind,
        event.fieldsJson,
        event.fingerprint,
        event.createdTime ?? null,
      );
    }
  });

  const writeDeletions = db.transaction((runId, baseId, tableId, recordIds) => {
    for (const recordId of recordIds) {
      insertEvent.run(runId, baseId, tableId, recordId, 'deleted', null, null, null);
    }
  });

  const discardRun = db.transaction((runId, finishedAt, counts, error) => {
    deleteRunEvents.run(runId);
    endRun(runId, 'incomplete', finishedAt, counts, error);
  });

  return {
    folder,

    startRun({ baseId, baseName, startedAt, trigger = 'manual' }) {
      const info = db
        .prepare(
          `INSERT INTO backup_runs (base_id, base_name, run_trigger, status, started_at)
           VALUES (?, ?, ?, 'running', ?)`,
        )
        .run(baseId, baseName, trigger, startedAt);
      return Number(info.lastInsertRowid);
    },

    // Stores the schema only when it differs from the base's latest version.
    saveSchemaVersion(runId, baseId, schema, createdAt) {
      const json = stableStringify(schema);
      const fingerprint = sha256(json);
      const latest = db
        .prepare('SELECT id, fingerprint FROM schema_versions WHERE base_id = ? ORDER BY id DESC LIMIT 1')
        .get(baseId);
      const versionId =
        latest && latest.fingerprint === fingerprint
          ? latest.id
          : Number(
              db
                .prepare(
                  'INSERT INTO schema_versions (base_id, fingerprint, schema_json, created_at) VALUES (?, ?, ?, ?)',
                )
                .run(baseId, fingerprint, json, createdAt).lastInsertRowid,
            );
      db.prepare('UPDATE backup_runs SET schema_version_id = ? WHERE id = ?').run(versionId, runId);
      return versionId;
    },

    getLatestVersions(baseId, tableId) {
      const rows = db
        .prepare(
          `SELECT e.record_id AS recordId, e.kind, e.fingerprint
           FROM record_events e
           JOIN (
             SELECT MAX(id) AS id FROM record_events
             WHERE base_id = ? AND table_id = ?
               AND run_id IN (SELECT id FROM backup_runs WHERE status = 'complete')
             GROUP BY record_id
           ) latest ON latest.id = e.id`,
        )
        .all(baseId, tableId);
      return new Map(rows.map((row) => [row.recordId, { kind: row.kind, fingerprint: row.fingerprint }]));
    },

    writeEvents(runId, baseId, tableId, events) {
      writeEvents(runId, baseId, tableId, events);
    },

    writeDeletions(runId, baseId, tableId, recordIds) {
      writeDeletions(runId, baseId, tableId, recordIds);
    },

    hasAttachment(attachmentId) {
      return !!db.prepare('SELECT 1 FROM attachments WHERE attachment_id = ?').get(attachmentId);
    },

    saveAttachment({ attachmentId, baseId, hash, filename, type, size, runId, savedAt }) {
      db.prepare(
        `INSERT OR IGNORE INTO attachments
           (attachment_id, base_id, hash, filename, type, size, first_run_id, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(attachmentId, baseId, hash, filename, type, size, runId, savedAt);
    },

    completeRun(runId, { finishedAt, counts }) {
      endRun(runId, 'complete', finishedAt, counts, null);
    },

    // An incomplete run is never a restore point, so its events are removed.
    failRun(runId, { finishedAt, counts, error }) {
      discardRun(runId, finishedAt, counts, error);
    },

    // Runs still marked running when the store opens were cut short by a quit or crash.
    discardInterruptedRuns(finishedAt) {
      const rows = db.prepare("SELECT * FROM backup_runs WHERE status = 'running' ORDER BY id").all();
      for (const row of rows) discardRun(row.id, finishedAt, toRun(row).counts, INTERRUPTED_ERROR);
      return rows.map(toRun);
    },

    getRun(runId) {
      return toRun(db.prepare('SELECT * FROM backup_runs WHERE id = ?').get(runId));
    },

    getRunEvents(runId) {
      return db
        .prepare(
          'SELECT table_id AS tableId, record_id AS recordId, kind FROM record_events WHERE run_id = ? ORDER BY id',
        )
        .all(runId);
    },

    listRestorePoints(baseId) {
      return db
        .prepare("SELECT * FROM backup_runs WHERE base_id = ? AND status = 'complete' ORDER BY id DESC")
        .all(baseId)
        .map(toRun);
    },

    getRecordsAsOf(baseId, tableId, runId) {
      return db
        .prepare(
          `SELECT e.record_id AS id, e.created_time AS createdTime, e.fields_json AS fieldsJson
           FROM record_events e
           JOIN (
             SELECT MAX(id) AS id FROM record_events
             WHERE base_id = ? AND table_id = ? AND run_id <= ?
               AND run_id IN (SELECT id FROM backup_runs WHERE status = 'complete')
             GROUP BY record_id
           ) latest ON latest.id = e.id
           WHERE e.kind != 'deleted'
           ORDER BY e.record_id`,
        )
        .all(baseId, tableId, runId)
        .map((row) => ({ id: row.id, createdTime: row.createdTime, fields: JSON.parse(row.fieldsJson) }));
    },

    getBaseSummary(baseId) {
      const lastRun = toRun(
        db.prepare('SELECT * FROM backup_runs WHERE base_id = ? ORDER BY id DESC LIMIT 1').get(baseId),
      );
      const lastComplete = toRun(
        db
          .prepare(
            "SELECT * FROM backup_runs WHERE base_id = ? AND status = 'complete' ORDER BY id DESC LIMIT 1",
          )
          .get(baseId),
      );
      const restorePointCount = db
        .prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE base_id = ? AND status = 'complete'")
        .get(baseId).n;
      // A complete run fetched every record of every table, so the records it
      // saw is the base's size at that restore point. Reading it instead of
      // replaying the event log keeps the Backups view instant on large bases.
      const recordCount = lastComplete ? lastComplete.counts.records : 0;
      const files = db
        .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE base_id = ?')
        .get(baseId);
      return {
        lastRun,
        lastComplete,
        restorePointCount,
        recordCount,
        fileCount: files.n,
        fileBytes: files.bytes,
      };
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openBackupStore };
