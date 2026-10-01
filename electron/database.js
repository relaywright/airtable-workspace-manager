const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

let db = null;
let dbPath = null;
let batchTxnOpen = false;

// Test-only override for the userData directory used when Electron's `app`
// isn't available (e.g. running under vitest, which requires this CJS module
// via Node's require() and so can't be intercepted by vi.mock('electron')).
// Left null in production; only tests that need real, distinct per-account
// file paths (e.g. demo mode isolation) call __setTestUserDataPath.
let testUserDataPath = null;

function __setTestUserDataPath(dir) {
  testUserDataPath = dir;
}

/**
 * Get the database file path
 */
function getDatabasePath(accountId = null) {
  // Use app.getPath only when running in Electron context
  if (app && typeof app.getPath === 'function') {
    const userDataPath = app.getPath('userData');
    if (accountId) {
      return path.join(userDataPath, `workspace-${accountId}.db`);
    }
    return path.join(userDataPath, 'workspace-manager.db');
  }
  // Fallback for testing: use an injected test directory when set, so tests
  // can exercise real per-account file isolation; otherwise stay in-memory.
  if (testUserDataPath) {
    if (accountId) {
      return path.join(testUserDataPath, `workspace-${accountId}.db`);
    }
    return path.join(testUserDataPath, 'workspace-manager.db');
  }
  return null;
}

/**
 * Initialize the database and create tables
 */
async function initDatabase(customPath = null) {
  dbPath = customPath || getDatabasePath();
  batchTxnOpen = false;

  // better-sqlite3 accepts ':memory:' for an in-memory database; use that
  // whenever no real path is available (matches the old sql.js in-memory
  // fallback used by tests and by initial pre-account startup).
  db = new Database(dbPath || ':memory:');

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Bases table: stores discovered Airtable bases
    CREATE TABLE IF NOT EXISTS bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      permission_level TEXT,
      schema_json TEXT,
      table_count INTEGER DEFAULT 0,
      field_count INTEGER DEFAULT 0,
      matches_convention INTEGER DEFAULT 0,
      user_description TEXT,
      user_tags TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_pulled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    -- Relationships table: detected sync connections between bases
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_base_id TEXT NOT NULL,
      target_base_id TEXT NOT NULL,
      source_table_name TEXT,
      target_table_name TEXT,
      confidence TEXT DEFAULT 'suspected',
      detection_reason TEXT,
      notes TEXT,
      status TEXT DEFAULT 'unverified',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_base_id) REFERENCES bases(id),
      FOREIGN KEY (target_base_id) REFERENCES bases(id),
      UNIQUE(source_base_id, target_base_id, source_table_name, target_table_name)
    )
  `);

  // Add columns to existing bases table if they don't exist
  const basesColumns = db.pragma('table_info(bases)');
  const basesColumnNames = basesColumns.map((c) => c.name);

  if (!basesColumnNames.includes('updated_at')) {
    db.exec('ALTER TABLE bases ADD COLUMN updated_at TEXT');
  }
  if (!basesColumnNames.includes('created_at')) {
    db.exec('ALTER TABLE bases ADD COLUMN created_at TEXT');
  }
  if (!basesColumnNames.includes('is_archived')) {
    db.exec('ALTER TABLE bases ADD COLUMN is_archived INTEGER DEFAULT 0');
  }
  if (!basesColumnNames.includes('matches_convention')) {
    db.exec('ALTER TABLE bases ADD COLUMN matches_convention INTEGER DEFAULT 0');
  }
  // Index must be created after the column migration above so it also applies to
  // databases that predate the matches_convention column.
  db.exec('CREATE INDEX IF NOT EXISTS idx_bases_matches_convention ON bases(matches_convention)');

  // Add columns to existing relationships table if they don't exist
  const relColumns = db.pragma('table_info(relationships)');
  const relColumnNames = relColumns.map((c) => c.name);

  if (!relColumnNames.includes('notes')) {
    db.exec('ALTER TABLE relationships ADD COLUMN notes TEXT');
  }
  if (!relColumnNames.includes('status')) {
    db.exec('ALTER TABLE relationships ADD COLUMN status TEXT DEFAULT "unverified"');
  }
  if (!relColumnNames.includes('updated_at')) {
    db.exec('ALTER TABLE relationships ADD COLUMN updated_at TEXT');
  }
  if (!relColumnNames.includes('type')) {
    db.exec('ALTER TABLE relationships ADD COLUMN type TEXT');
  }
  if (!relColumnNames.includes('created_at')) {
    db.exec('ALTER TABLE relationships ADD COLUMN created_at TEXT');
  }

  db.exec(`
    -- Schema snapshots: historical record for change detection (V2)
    CREATE TABLE IF NOT EXISTS schema_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_id TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      pulled_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (base_id) REFERENCES bases(id)
    )
  `);

  db.exec(`
    -- App settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create remaining indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_base_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_base_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_base ON schema_snapshots(base_id)');

  return db;
}

/**
 * Helper to get a single row
 */
function getRow(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/**
 * Helper to get all rows
 */
function getAllRows(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/**
 * Helper to run a statement
 */
function runStatement(sql, params = []) {
  const info = db.prepare(sql).run(...params);
  return { changes: info.changes };
}

/**
 * Database operations wrapper
 */
const database = {
  /**
   * Begin batch mode - wraps subsequent writes in a real SQL transaction so
   * they commit (or roll back) together instead of one fsync per statement.
   * Call endBatch() when done to commit.
   */
  beginBatch() {
    if (batchTxnOpen) return; // already in a batch; avoid nested BEGIN errors
    db.exec('BEGIN');
    batchTxnOpen = true;
  },

  /**
   * End batch mode and commit the transaction.
   */
  endBatch() {
    if (db && batchTxnOpen) {
      db.exec('COMMIT');
      batchTxnOpen = false;
    }
  },

  /**
   * End batch mode and roll back the transaction instead of committing.
   * Callers should use this on the "whole operation failed" error path
   * instead of endBatch(), so partial writes made before the failure never
   * persist. Resets the batch flags the same way endBatch() does, so a
   * subsequent beginBatch() is never a no-op. Safe to call when no
   * transaction is open (e.g. the failure happened before beginBatch()).
   */
  rollbackBatch() {
    batchTxnOpen = false;
    // SQLite auto-rolls back on some errors (e.g. SQLITE_FULL), so ask the
    // connection whether a transaction is still open instead of trusting our flag.
    if (db && db.inTransaction) {
      db.exec('ROLLBACK');
    }
  },

  /**
   * Get all bases with full data (including schema JSON).
   * Use getAllBasesLite() for listing/display to avoid loading large schema blobs.
   * @param {boolean} includeArchived - Whether to include archived bases (default: true)
   */
  getAllBases(includeArchived = true) {
    if (!db) throw new Error('Database not initialized');
    const whereClause = includeArchived ? '' : 'WHERE (is_archived IS NULL OR is_archived = 0)';
    const rows = getAllRows(`
      SELECT id, name, permission_level as permissionLevel, schema_json as schemaJson,
             table_count as tableCount, field_count as fieldCount, matches_convention as matchesConvention,
             user_description as userDescription, user_tags as userTags,
             first_seen_at as firstSeenAt, last_pulled_at as lastPulledAt,
             created_at as createdAt, COALESCE(is_archived, 0) as isArchived
      FROM bases
      ${whereClause}
      ORDER BY name ASC
    `);
    return rows;
  },

  /**
   * Get all bases WITHOUT schema JSON - lightweight for listing/display.
   * @param {boolean} includeArchived - Whether to include archived bases (default: true)
   */
  getAllBasesLite(includeArchived = true) {
    if (!db) throw new Error('Database not initialized');
    const whereClause = includeArchived ? '' : 'WHERE (is_archived IS NULL OR is_archived = 0)';
    const rows = getAllRows(`
      SELECT id, name, permission_level as permissionLevel,
             table_count as tableCount, field_count as fieldCount, matches_convention as matchesConvention,
             user_description as userDescription, user_tags as userTags,
             first_seen_at as firstSeenAt, last_pulled_at as lastPulledAt,
             created_at as createdAt, COALESCE(is_archived, 0) as isArchived
      FROM bases
      ${whereClause}
      ORDER BY name ASC
    `);
    return rows;
  },

  /**
   * Get a single base by ID
   */
  getBase(baseId) {
    if (!db) throw new Error('Database not initialized');
    return getRow(
      `
      SELECT id, name, permission_level as permissionLevel, schema_json as schemaJson,
             table_count as tableCount, field_count as fieldCount, matches_convention as matchesConvention,
             user_description as userDescription, user_tags as userTags,
             first_seen_at as firstSeenAt, last_pulled_at as lastPulledAt,
             created_at as createdAt, COALESCE(is_archived, 0) as isArchived
      FROM bases
      WHERE id = ?
    `,
      [baseId],
    );
  },

  /**
   * Archive a base (soft delete)
   */
  archiveBase(baseId) {
    if (!db) throw new Error('Database not initialized');
    const result = runStatement('UPDATE bases SET is_archived = 1 WHERE id = ?', [baseId]);
    return result;
  },

  /**
   * Unarchive a base
   */
  unarchiveBase(baseId) {
    if (!db) throw new Error('Database not initialized');
    const result = runStatement('UPDATE bases SET is_archived = 0 WHERE id = ?', [baseId]);
    return result;
  },

  /**
   * Get list of base IDs that exist in local DB
   */
  getAllBaseIds() {
    if (!db) throw new Error('Database not initialized');
    const rows = getAllRows('SELECT id FROM bases');
    return rows.map((r) => r.id);
  },

  /**
   * Insert or update a base
   */
  upsertBase(base) {
    if (!db) throw new Error('Database not initialized');

    // Check if exists
    const existing = getRow('SELECT id FROM bases WHERE id = ?', [base.id]);

    if (existing) {
      // Update
      const result = runStatement(
        `
        UPDATE bases SET
          name = ?,
          permission_level = ?,
          matches_convention = ?,
          schema_json = COALESCE(?, schema_json),
          table_count = COALESCE(?, table_count),
          field_count = COALESCE(?, field_count),
          last_pulled_at = datetime('now')
        WHERE id = ?
      `,
        [
          base.name,
          base.permissionLevel || null,
          base.matchesConvention ? 1 : 0,
          base.schemaJson || null,
          base.tableCount || null,
          base.fieldCount || null,
          base.id,
        ],
      );
      return result;
    } else {
      // Insert
      const result = runStatement(
        `
        INSERT INTO bases (id, name, permission_level, matches_convention, schema_json, table_count, field_count, last_pulled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        [
          base.id,
          base.name,
          base.permissionLevel || null,
          base.matchesConvention ? 1 : 0,
          base.schemaJson || null,
          base.tableCount || 0,
          base.fieldCount || 0,
        ],
      );
      return result;
    }
  },

  /**
   * Update base schema
   */
  updateBaseSchema(baseId, data) {
    if (!db) throw new Error('Database not initialized');
    const result = runStatement(
      `
      UPDATE bases
      SET schema_json = ?,
          table_count = ?,
          field_count = ?,
          last_pulled_at = datetime('now')
      WHERE id = ?
    `,
      [data.schemaJson, data.tableCount, data.fieldCount, baseId],
    );
    return result;
  },

  /**
   * Set whether a base matches the current naming convention.
   * Used to recompute matches_convention for all bases after the
   * naming convention settings change.
   */
  setBaseMatchesConvention(baseId, matches) {
    if (!db) throw new Error('Database not initialized');
    const result = runStatement('UPDATE bases SET matches_convention = ? WHERE id = ?', [
      matches ? 1 : 0,
      baseId,
    ]);
    return result;
  },

  /**
   * Update base description
   */
  updateBaseDescription(baseId, description) {
    if (!db) throw new Error('Database not initialized');
    const result = runStatement(
      `
      UPDATE bases
      SET user_description = ?
      WHERE id = ?
    `,
      [description, baseId],
    );
    return result;
  },

  /**
   * Delete a base
   */
  deleteBase(baseId) {
    if (!db) throw new Error('Database not initialized');
    // Delete relationships first
    runStatement('DELETE FROM relationships WHERE source_base_id = ? OR target_base_id = ?', [
      baseId,
      baseId,
    ]);
    runStatement('DELETE FROM schema_snapshots WHERE base_id = ?', [baseId]);
    const result = runStatement('DELETE FROM bases WHERE id = ?', [baseId]);
    return result;
  },

  /**
   * Update base tags
   */
  updateBaseTags(baseId, tags) {
    if (!db) throw new Error('Database not initialized');
    const tagsJson = JSON.stringify(tags || []);
    const result = runStatement(
      `
      UPDATE bases
      SET user_tags = ?
      WHERE id = ?
    `,
      [tagsJson, baseId],
    );
    return result;
  },

  /**
   * Get all unique tags across all bases
   */
  getAllTags() {
    if (!db) throw new Error('Database not initialized');
    const rows = getAllRows('SELECT user_tags as userTags FROM bases WHERE user_tags IS NOT NULL');
    const tagSet = new Set();
    for (const row of rows) {
      if (row.userTags) {
        try {
          const tags = JSON.parse(row.userTags);
          if (Array.isArray(tags)) {
            tags.forEach((tag) => tagSet.add(tag));
          }
        } catch (err) {
          logger.warn('Database', 'Skipping malformed user_tags JSON in getAllTags:', err.message);
        }
      }
    }
    return Array.from(tagSet).sort();
  },

  /**
   * Rename a tag across all bases
   */
  renameTag(oldName, newName) {
    if (!db) throw new Error('Database not initialized');
    const rows = getAllRows('SELECT id, user_tags as userTags FROM bases WHERE user_tags LIKE ?', [
      `%"${oldName}"%`,
    ]);
    let updated = 0;
    for (const row of rows) {
      if (row.userTags) {
        try {
          const tags = JSON.parse(row.userTags);
          if (Array.isArray(tags)) {
            const index = tags.indexOf(oldName);
            if (index !== -1) {
              tags[index] = newName;
              runStatement('UPDATE bases SET user_tags = ? WHERE id = ?', [JSON.stringify(tags), row.id]);
              updated++;
            }
          }
        } catch (err) {
          logger.warn(
            'Database',
            `Skipping malformed user_tags JSON for base ${row.id} in renameTag:`,
            err.message,
          );
        }
      }
    }
    return { updated };
  },

  /**
   * Delete a tag from all bases
   */
  deleteTag(tagName) {
    if (!db) throw new Error('Database not initialized');
    const rows = getAllRows('SELECT id, user_tags as userTags FROM bases WHERE user_tags LIKE ?', [
      `%"${tagName}"%`,
    ]);
    let updated = 0;
    for (const row of rows) {
      if (row.userTags) {
        try {
          const tags = JSON.parse(row.userTags);
          if (Array.isArray(tags)) {
            const filtered = tags.filter((t) => t !== tagName);
            runStatement('UPDATE bases SET user_tags = ? WHERE id = ?', [JSON.stringify(filtered), row.id]);
            updated++;
          }
        } catch (err) {
          logger.warn(
            'Database',
            `Skipping malformed user_tags JSON for base ${row.id} in deleteTag:`,
            err.message,
          );
        }
      }
    }
    return { updated };
  },

  /**
   * Get all relationships
   */
  getAllRelationships() {
    if (!db) throw new Error('Database not initialized');
    return getAllRows(`
      SELECT id, source_base_id as sourceBaseId, target_base_id as targetBaseId,
             source_table_name as sourceTableName, target_table_name as targetTableName,
             confidence, detection_reason as detectionReason, notes, status, type,
             created_at as createdAt
      FROM relationships
    `);
  },

  /**
   * Get relationships for a specific base
   */
  getRelationshipsForBase(baseId) {
    if (!db) throw new Error('Database not initialized');
    return getAllRows(
      `
      SELECT id, source_base_id as sourceBaseId, target_base_id as targetBaseId,
             source_table_name as sourceTableName, target_table_name as targetTableName,
             confidence, detection_reason as detectionReason, notes, status, type,
             created_at as createdAt
      FROM relationships
      WHERE source_base_id = ? OR target_base_id = ?
    `,
      [baseId, baseId],
    );
  },

  /**
   * Insert a relationship
   */
  insertRelationship(relationship) {
    if (!db) throw new Error('Database not initialized');
    try {
      const result = runStatement(
        `
        INSERT INTO relationships
          (source_base_id, target_base_id, source_table_name, target_table_name, confidence, detection_reason, type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          relationship.sourceBaseId,
          relationship.targetBaseId,
          relationship.sourceTableName || null,
          relationship.targetTableName || null,
          relationship.confidence || 'suspected',
          relationship.detectionReason || null,
          relationship.type || null,
        ],
      );
      return result;
    } catch (err) {
      // Handle unique constraint violation
      if (err.message && err.message.includes('UNIQUE constraint')) {
        return { changes: 0 };
      }
      throw err;
    }
  },

  /**
   * Update a relationship
   */
  updateRelationship(id, updates) {
    if (!db) throw new Error('Database not initialized');
    const { notes, status } = updates;
    const result = runStatement(
      `
      UPDATE relationships
      SET notes = ?,
          status = ?
      WHERE id = ?
    `,
      [notes !== undefined ? notes : null, status || 'unverified', id],
    );
    return result;
  },

  /**
   * Get a single relationship by ID
   */
  getRelationship(id) {
    if (!db) throw new Error('Database not initialized');
    return getRow(
      `
      SELECT id, source_base_id as sourceBaseId, target_base_id as targetBaseId,
             source_table_name as sourceTableName, target_table_name as targetTableName,
             confidence, detection_reason as detectionReason, notes, status, type,
             created_at as createdAt
      FROM relationships
      WHERE id = ?
    `,
      [id],
    );
  },

  /**
   * Clear all relationships
   */
  clearRelationships() {
    if (!db) throw new Error('Database not initialized');
    const result = runStatement('DELETE FROM relationships');
    return result;
  },

  /**
   * Get a setting value
   */
  getSetting(key) {
    if (!db) throw new Error('Database not initialized');
    const row = getRow('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  },

  /**
   * Set a setting value
   */
  setSetting(key, value) {
    if (!db) throw new Error('Database not initialized');
    const existing = getRow('SELECT key FROM settings WHERE key = ?', [key]);
    let result;
    if (existing) {
      result = runStatement(
        `
        UPDATE settings SET value = ? WHERE key = ?
      `,
        [value, key],
      );
    } else {
      result = runStatement(
        `
        INSERT INTO settings (key, value) VALUES (?, ?)
      `,
        [key, value],
      );
    }
    return result;
  },

  /**
   * Get all settings as a key-value object
   */
  getAllSettings() {
    if (!db) throw new Error('Database not initialized');
    const rows = getAllRows('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  },

  /**
   * Search across all base schemas for matching table names, field names, or field types.
   * @param {string} query - Search term
   * @param {Object} options - Filter options: { filter: 'all'|'tables'|'fields'|'linkedRecords'|'formulas' }
   * @returns {Array} - Array of match objects
   */
  searchSchemas(query, options = {}) {
    if (!db) throw new Error('Database not initialized');
    if (!query || !query.trim()) return [];

    const lowerQuery = query.trim().toLowerCase();
    const filter = options.filter || 'all';
    const bases = getAllRows(
      'SELECT id, name, schema_json as schemaJson FROM bases WHERE schema_json IS NOT NULL',
    );
    const results = [];

    for (const base of bases) {
      let schema;
      try {
        schema = JSON.parse(base.schemaJson);
      } catch {
        continue;
      }

      const tables = schema.tables || [];
      for (const table of tables) {
        // Match table names
        if ((filter === 'all' || filter === 'tables') && table.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            baseId: base.id,
            baseName: base.name,
            tableName: table.name,
            fieldName: null,
            fieldType: null,
            matchType: 'table',
          });
        }

        // Match fields
        const fields = table.fields || [];
        for (const field of fields) {
          const nameMatch = field.name.toLowerCase().includes(lowerQuery);
          const typeMatch = field.type.toLowerCase().includes(lowerQuery);

          // Apply filter
          if (filter === 'linkedRecords' && field.type !== 'multipleRecordLinks') continue;
          if (filter === 'formulas' && field.type !== 'formula') continue;
          if (filter === 'tables') continue; // tables-only filter skips fields

          if (nameMatch) {
            results.push({
              baseId: base.id,
              baseName: base.name,
              tableName: table.name,
              fieldName: field.name,
              fieldType: field.type,
              matchType: 'field',
            });
          } else if (typeMatch && filter === 'all') {
            results.push({
              baseId: base.id,
              baseName: base.name,
              tableName: table.name,
              fieldName: field.name,
              fieldType: field.type,
              matchType: 'fieldType',
            });
          }
        }
      }
    }

    return results;
  },

  /**
   * Create a schema snapshot. Pass `pulledAt` (UTC, in SQLite's
   * 'YYYY-MM-DD HH:MM:SS' format) to backdate it; omit it to stamp the
   * current time.
   */
  createSnapshot(baseId, schemaJson, pulledAt = null) {
    if (!db) throw new Error('Database not initialized');
    const info = db
      .prepare(
        `
      INSERT INTO schema_snapshots (base_id, schema_json, pulled_at)
      VALUES (?, ?, COALESCE(?, datetime('now')))
    `,
      )
      .run(baseId, schemaJson, pulledAt);
    return { id: info.lastInsertRowid };
  },

  /**
   * Get snapshots for a base
   */
  getSnapshots(baseId, limit = 10) {
    if (!db) throw new Error('Database not initialized');
    return getAllRows(
      `
      SELECT id, base_id as baseId, schema_json as schemaJson, pulled_at as pulledAt
      FROM schema_snapshots
      WHERE base_id = ?
      ORDER BY pulled_at DESC
      LIMIT ?
    `,
      [baseId, limit],
    );
  },

  /**
   * Get the latest snapshot for a base
   */
  getLatestSnapshot(baseId) {
    if (!db) throw new Error('Database not initialized');
    return getRow(
      `
      SELECT id, base_id as baseId, schema_json as schemaJson, pulled_at as pulledAt
      FROM schema_snapshots
      WHERE base_id = ?
      ORDER BY pulled_at DESC
      LIMIT 1
    `,
      [baseId],
    );
  },

  /**
   * Cleanup old snapshots, keeping only the most recent ones
   */
  cleanupOldSnapshots(baseId, keepCount = 10) {
    if (!db) throw new Error('Database not initialized');
    // Get IDs of snapshots to keep
    const toKeep = getAllRows(
      `
      SELECT id FROM schema_snapshots
      WHERE base_id = ?
      ORDER BY pulled_at DESC
      LIMIT ?
    `,
      [baseId, keepCount],
    );

    const keepIds = toKeep.map((r) => r.id);

    if (keepIds.length > 0) {
      const placeholders = keepIds.map(() => '?').join(',');
      const result = runStatement(
        `
        DELETE FROM schema_snapshots
        WHERE base_id = ? AND id NOT IN (${placeholders})
      `,
        [baseId, ...keepIds],
      );
      return { deleted: result.changes };
    }
    return { deleted: 0 };
  },

  /**
   * Get all snapshots across all bases (for change log)
   */
  getAllSnapshots(limit = 100) {
    if (!db) throw new Error('Database not initialized');
    return getAllRows(
      `
      SELECT s.id, s.base_id as baseId, s.schema_json as schemaJson, s.pulled_at as pulledAt,
             b.name as baseName
      FROM schema_snapshots s
      LEFT JOIN bases b ON s.base_id = b.id
      ORDER BY s.pulled_at DESC
      LIMIT ?
    `,
      [limit],
    );
  },

  /**
   * Clear all data
   */
  clearAllData() {
    if (!db) throw new Error('Database not initialized');
    runStatement('DELETE FROM relationships');
    runStatement('DELETE FROM schema_snapshots');
    runStatement('DELETE FROM bases');
    return { success: true };
  },

  /**
   * Get database instance (for testing)
   */
  getDb() {
    return db;
  },

  /**
   * Close the database. Rolls back any open batch transaction first so a
   * crash-before-endBatch() (or a test simulating one) never leaves a
   * half-committed transaction dangling on the connection.
   */
  close() {
    if (db) {
      if (batchTxnOpen) {
        // Best-effort: if ROLLBACK itself throws (e.g. the connection is
        // already broken), we still proceed to close and null out `db`
        // below rather than leaving the module in a stuck state.
        try {
          db.exec('ROLLBACK');
        } catch (err) {
          logger.error('Database', 'Failed to roll back open transaction on close:', err.message);
        }
        batchTxnOpen = false;
      }
      db.close();
      db = null;
    }
  },
};

/**
 * Switch to a different database file (for multi-account support).
 * Closes the current database, opens the new one, and runs table creation.
 */
async function switchDatabase(accountId) {
  const previousPath = dbPath;

  // Close the current database before switching. better-sqlite3 persists
  // synchronously on every commit, so there is no explicit save step here
  // (unlike the old sql.js export()/writeFileSync flow) -- close() below
  // also rolls back any open batch transaction first.
  if (db) {
    database.close();
  }

  const newPath = getDatabasePath(accountId);
  try {
    await initDatabase(newPath);
    logger.info('Database', `Switched to database for account ${accountId}: ${newPath}`);
  } catch (err) {
    logger.error('Database', `Failed to open database for account ${accountId}:`, err.message);
    // Try to reopen the previous database so the app isn't left without one
    if (previousPath) {
      try {
        await initDatabase(previousPath);
        logger.warn('Database', 'Reverted to previous database');
      } catch (revertErr) {
        logger.error('Database', 'CRITICAL: Could not revert to previous database:', revertErr.message);
      }
    }
    throw err;
  }
}

module.exports = {
  initDatabase,
  database,
  getDatabasePath,
  switchDatabase,
  __setTestUserDataPath,
};
