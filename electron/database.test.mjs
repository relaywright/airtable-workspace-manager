import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  initDatabase,
  database,
  getDatabasePath,
  switchDatabase,
  __setTestUserDataPath,
} from './database.js';

describe('Database', () => {
  beforeEach(async () => {
    // Initialize in-memory database for testing (pass null for no file persistence)
    await initDatabase(null);
  });

  afterEach(() => {
    database.close();
  });

  describe('initDatabase', () => {
    it('creates the database instance', () => {
      expect(database.getDb()).not.toBeNull();
    });

    it('creates bases table', () => {
      const db = database.getDb();
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bases'").get();
      expect(row.name).toBe('bases');
    });

    it('creates relationships table', () => {
      const db = database.getDb();
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='relationships'")
        .get();
      expect(row.name).toBe('relationships');
    });

    it('creates settings table', () => {
      const db = database.getDb();
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
      expect(row.name).toBe('settings');
    });

    it('creates schema_snapshots table', () => {
      const db = database.getDb();
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_snapshots'")
        .get();
      expect(row.name).toBe('schema_snapshots');
    });
  });

  describe('upsertBase', () => {
    it('inserts a new base', () => {
      const result = database.upsertBase({
        id: 'app123',
        name: 'Test Base',
        permissionLevel: 'create',
        matchesConvention: true,
      });
      expect(result.changes).toBe(1);

      const base = database.getBase('app123');
      expect(base).toBeDefined();
      expect(base.name).toBe('Test Base');
      expect(base.permissionLevel).toBe('create');
      expect(base.matchesConvention).toBe(1);
    });

    it('updates an existing base', () => {
      database.upsertBase({
        id: 'app123',
        name: 'Original Name',
        permissionLevel: 'edit',
        matchesConvention: false,
      });

      database.upsertBase({
        id: 'app123',
        name: 'Updated Name',
        permissionLevel: 'create',
        matchesConvention: true,
      });

      const base = database.getBase('app123');
      expect(base.name).toBe('Updated Name');
      expect(base.permissionLevel).toBe('create');
      expect(base.matchesConvention).toBe(1);
    });

    it('handles null schema', () => {
      database.upsertBase({
        id: 'app123',
        name: 'Test Base',
        permissionLevel: 'create',
        matchesConvention: false,
        schemaJson: null,
      });

      const base = database.getBase('app123');
      expect(base.schemaJson).toBeNull();
    });
  });

  describe('getAllBases', () => {
    it('returns empty array when no bases', () => {
      const bases = database.getAllBases();
      expect(bases).toEqual([]);
    });

    it('returns all bases sorted by name', () => {
      database.upsertBase({ id: 'app2', name: 'Beta', permissionLevel: 'edit', matchesConvention: false });
      database.upsertBase({ id: 'app1', name: 'Alpha', permissionLevel: 'create', matchesConvention: true });
      database.upsertBase({ id: 'app3', name: 'Gamma', permissionLevel: 'read', matchesConvention: false });

      const bases = database.getAllBases();
      expect(bases).toHaveLength(3);
      expect(bases[0].name).toBe('Alpha');
      expect(bases[1].name).toBe('Beta');
      expect(bases[2].name).toBe('Gamma');
    });
  });

  describe('getBase', () => {
    it('returns undefined for non-existent base', () => {
      const base = database.getBase('nonexistent');
      expect(base).toBeUndefined();
    });

    it('returns the base with all fields', () => {
      database.upsertBase({
        id: 'app123',
        name: 'Test Base',
        permissionLevel: 'create',
        matchesConvention: true,
        tableCount: 5,
        fieldCount: 25,
      });

      const base = database.getBase('app123');
      expect(base.id).toBe('app123');
      expect(base.name).toBe('Test Base');
      expect(base.permissionLevel).toBe('create');
      expect(base.matchesConvention).toBe(1);
      expect(base.tableCount).toBe(5);
      expect(base.fieldCount).toBe(25);
    });
  });

  describe('updateBaseSchema', () => {
    it('updates schema for existing base', () => {
      database.upsertBase({
        id: 'app123',
        name: 'Test Base',
        permissionLevel: 'create',
        matchesConvention: false,
      });

      const schema = JSON.stringify({ tables: [{ id: 'tbl1', name: 'Table 1' }] });
      database.updateBaseSchema('app123', {
        schemaJson: schema,
        tableCount: 1,
        fieldCount: 5,
      });

      const base = database.getBase('app123');
      expect(base.schemaJson).toBe(schema);
      expect(base.tableCount).toBe(1);
      expect(base.fieldCount).toBe(5);
    });
  });

  describe('updateBaseDescription', () => {
    it('updates description for existing base', () => {
      database.upsertBase({
        id: 'app123',
        name: 'Test Base',
        permissionLevel: 'create',
        matchesConvention: false,
      });

      database.updateBaseDescription('app123', 'New description');

      const base = database.getBase('app123');
      expect(base.userDescription).toBe('New description');
    });
  });

  describe('deleteBase', () => {
    it('deletes a base and its relationships', () => {
      database.upsertBase({
        id: 'app1',
        name: 'Base 1',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app2',
        name: 'Base 2',
        permissionLevel: 'create',
        matchesConvention: false,
      });

      database.insertRelationship({
        sourceBaseId: 'app1',
        targetBaseId: 'app2',
        sourceTableName: 'Table 1',
        targetTableName: 'Table 2',
        confidence: 'confirmed',
      });

      database.deleteBase('app1');

      expect(database.getBase('app1')).toBeUndefined();
      expect(database.getAllRelationships()).toHaveLength(0);
    });
  });

  describe('insertRelationship', () => {
    beforeEach(() => {
      database.upsertBase({
        id: 'app1',
        name: 'Base 1',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app2',
        name: 'Base 2',
        permissionLevel: 'create',
        matchesConvention: false,
      });
    });

    it('inserts a new relationship', () => {
      const result = database.insertRelationship({
        sourceBaseId: 'app1',
        targetBaseId: 'app2',
        sourceTableName: 'Products',
        targetTableName: 'SYNC Products',
        confidence: 'confirmed',
        detectionReason: 'Table name match',
      });
      expect(result.changes).toBe(1);
    });
  });

  describe('getAllRelationships', () => {
    beforeEach(() => {
      database.upsertBase({
        id: 'app1',
        name: 'Base 1',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app2',
        name: 'Base 2',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app3',
        name: 'Base 3',
        permissionLevel: 'create',
        matchesConvention: false,
      });
    });

    it('returns empty array when no relationships', () => {
      expect(database.getAllRelationships()).toEqual([]);
    });

    it('returns all relationships', () => {
      database.insertRelationship({
        sourceBaseId: 'app1',
        targetBaseId: 'app2',
      });
      database.insertRelationship({
        sourceBaseId: 'app2',
        targetBaseId: 'app3',
      });

      const relationships = database.getAllRelationships();
      expect(relationships).toHaveLength(2);
    });
  });

  describe('getRelationshipsForBase', () => {
    beforeEach(() => {
      database.upsertBase({
        id: 'app1',
        name: 'Base 1',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app2',
        name: 'Base 2',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app3',
        name: 'Base 3',
        permissionLevel: 'create',
        matchesConvention: false,
      });
    });

    it('returns relationships where base is source or target', () => {
      database.insertRelationship({ sourceBaseId: 'app1', targetBaseId: 'app2' });
      database.insertRelationship({ sourceBaseId: 'app3', targetBaseId: 'app1' });

      const relationships = database.getRelationshipsForBase('app1');
      expect(relationships).toHaveLength(2);
    });
  });

  describe('clearRelationships', () => {
    it('deletes all relationships', () => {
      database.upsertBase({
        id: 'app1',
        name: 'Base 1',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app2',
        name: 'Base 2',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.insertRelationship({ sourceBaseId: 'app1', targetBaseId: 'app2' });

      database.clearRelationships();

      expect(database.getAllRelationships()).toHaveLength(0);
    });
  });

  describe('settings', () => {
    it('getSetting returns null for non-existent key', () => {
      expect(database.getSetting('nonexistent')).toBeNull();
    });

    it('setSetting stores and getSetting retrieves value', () => {
      database.setSetting('testKey', 'testValue');
      expect(database.getSetting('testKey')).toBe('testValue');
    });

    it('setSetting updates existing key', () => {
      database.setSetting('testKey', 'value1');
      database.setSetting('testKey', 'value2');
      expect(database.getSetting('testKey')).toBe('value2');
    });
  });

  describe('clearAllData', () => {
    it('clears all tables', () => {
      database.upsertBase({
        id: 'app1',
        name: 'Base 1',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.upsertBase({
        id: 'app2',
        name: 'Base 2',
        permissionLevel: 'create',
        matchesConvention: false,
      });
      database.insertRelationship({ sourceBaseId: 'app1', targetBaseId: 'app2' });

      database.clearAllData();

      expect(database.getAllBases()).toHaveLength(0);
      expect(database.getAllRelationships()).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws error when database not initialized', () => {
      database.close();
      expect(() => database.getAllBases()).toThrow('Database not initialized');
    });
  });
});

// This suite does NOT share the outer describe's beforeEach/afterEach — it needs
// full manual control over the on-disk database file to simulate a database that
// predates the matches_convention column.
describe('initDatabase migration for pre-existing databases', () => {
  let tmpPath;

  afterEach(() => {
    database.close();
    if (tmpPath) {
      for (const p of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
    tmpPath = undefined;
  });

  it('adds matches_convention to a bases table that predates the column, and lets it round-trip', async () => {
    // Build a database file shaped like it was created before this column existed.
    // "legacy_flag" stands in for whatever old boolean column used to live here —
    // it is intentionally never referenced by app code, just present in the row shape.
    tmpPath = path.join(
      os.tmpdir(),
      `pre-existing-bases-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const legacyDb = new Database(tmpPath);
    legacyDb.exec(`
      CREATE TABLE bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        permission_level TEXT,
        schema_json TEXT,
        table_count INTEGER DEFAULT 0,
        field_count INTEGER DEFAULT 0,
        legacy_flag INTEGER DEFAULT 0,
        user_description TEXT,
        user_tags TEXT,
        first_seen_at TEXT DEFAULT (datetime('now')),
        last_pulled_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        is_archived INTEGER DEFAULT 0
      )
    `);
    legacyDb.exec(
      "INSERT INTO bases (id, name, permission_level, legacy_flag) VALUES ('app1', 'Old Base', 'create', 1)",
    );
    legacyDb.close();

    // (a) initDatabase / getAllBases must not throw "no such column: matches_convention"
    await initDatabase(tmpPath);
    expect(() => database.getAllBases()).not.toThrow();

    const bases = database.getAllBases();
    expect(bases).toHaveLength(1);
    expect(bases[0].name).toBe('Old Base');

    // (b) the column now exists on the migrated table
    const columnRows = database.getDb().pragma('table_info(bases)');
    const columnNames = columnRows.map((row) => row.name);
    expect(columnNames).toContain('matches_convention');

    // (c) setBaseMatchesConvention followed by a read round-trips
    database.setBaseMatchesConvention('app1', true);
    const updated = database.getBase('app1');
    expect(updated.matchesConvention).toBe(1);
  });
});

describe('demo mode database isolation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `demo-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    __setTestUserDataPath(tmpDir);
  });

  afterEach(() => {
    database.close();
    __setTestUserDataPath(null);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = undefined;
  });

  it('demo mode uses an isolated database', async () => {
    await initDatabase(getDatabasePath('acct1'));
    database.upsertBase({
      id: 'appRealAcct10001',
      name: 'Real Workspace Base',
      permissionLevel: 'create',
    });

    await switchDatabase('demo');
    database.upsertBase({
      id: 'appDemoOrders0001',
      name: 'Orders & Fulfillment',
      permissionLevel: 'create',
    });
    expect(database.getAllBases()).toHaveLength(1);

    await switchDatabase('acct1');

    const acct1Bases = database.getAllBases();
    expect(acct1Bases).toHaveLength(1);
    expect(acct1Bases[0].id).toBe('appRealAcct10001');
    expect(acct1Bases.some((b) => b.id.startsWith('appDemo'))).toBe(false);
  });
});

// better-sqlite3 port smokes (Task 6): WAL mode, crash-safe batching, and
// clean handle handoff on account switch. Each test uses its own fresh temp
// dir/file so it doesn't interact with the shared in-memory DB used above.
describe('better-sqlite3 storage', () => {
  let dir;
  let dbPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-'));
    dbPath = path.join(dir, 'test.db');
  });

  afterEach(() => {
    database.close();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  it('uses WAL journal mode', async () => {
    await initDatabase(dbPath);
    expect(database.getDb().pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('uncommitted batch is rolled back after reopen', async () => {
    await initDatabase(dbPath);
    database.upsertBase({ id: 'appDemoOrders0001', name: 'Kept', permissionLevel: 'create' });
    database.beginBatch();
    database.upsertBase({ id: 'appDemoProduct001', name: 'Lost', permissionLevel: 'create' });
    database.close(); // simulate crash: no endBatch()
    await initDatabase(dbPath);
    expect(database.getBase('appDemoOrders0001')).toBeTruthy();
    expect(database.getBase('appDemoProduct001')).toBeFalsy();
  });

  it('switchDatabase closes the previous handle', async () => {
    __setTestUserDataPath(dir);
    await switchDatabase('acctA');
    const aPath = getDatabasePath('acctA');
    await switchDatabase('acctB');
    expect(() => fs.rmSync(aPath)).not.toThrow();
    __setTestUserDataPath(null);
  });

  // Fix round 1 regression: rollbackBatch() must both discard the open
  // transaction AND reset the batch flags, so a later beginBatch() isn't a
  // silent no-op (which is exactly what happened before rollbackBatch()
  // existed and callers had to abuse endBatch() -- a commit -- on error).
  it('rollbackBatch discards the open transaction and resets the batch flag for the next one', async () => {
    await initDatabase(dbPath);
    database.beginBatch();
    database.upsertBase({ id: 'appDemoProduct001', name: 'Rolled Back', permissionLevel: 'create' });
    database.rollbackBatch();
    expect(database.getBase('appDemoProduct001')).toBeFalsy();

    database.beginBatch();
    database.upsertBase({ id: 'appDemoOrders0001', name: 'Kept', permissionLevel: 'create' });
    database.endBatch();
    expect(database.getBase('appDemoOrders0001')).toBeTruthy();
  });
});
