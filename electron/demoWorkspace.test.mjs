import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  listDemoBases,
  getDemoBaseSchema,
  getDemoBaseHistory,
  DemoAirtableClient,
  DEMO_ACCOUNT_ID,
} = require('./demoWorkspace.js');
const { detectRelationships } = require('./relationshipDetector.js');

const ID = /^(app|tbl|fld)[A-Za-z0-9]{14}$/;
const PERMISSION_LEVELS = ['create', 'edit', 'comment', 'read'];

function loadWorkspace() {
  const bases = listDemoBases();
  const tables = new Map(); // tableId -> { baseId, table }
  for (const base of bases) {
    for (const table of getDemoBaseSchema(base.id).tables) {
      tables.set(table.id, { baseId: base.id, table });
    }
  }
  return { bases, tables };
}

describe('demo workspace', () => {
  it('has fifteen bases with well-formed, unique, obviously fake ids', () => {
    const bases = listDemoBases();
    expect(bases).toHaveLength(15);

    const seen = new Set();
    const expectFakeId = (id) => {
      expect(id).toMatch(ID);
      expect(id).toContain('Demo');
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    };
    for (const b of bases) {
      expect(PERMISSION_LEVELS).toContain(b.permissionLevel);
      expectFakeId(b.id);
      const schema = getDemoBaseSchema(b.id);
      for (const t of schema.tables) {
        expectFakeId(t.id);
        for (const f of t.fields) expectFakeId(f.id);
      }
    }
  });

  it('only references tables and fields that exist', () => {
    const { tables } = loadWorkspace();

    for (const { table } of tables.values()) {
      const fieldsById = new Map(table.fields.map((f) => [f.id, f]));
      expect(fieldsById.has(table.primaryFieldId)).toBe(true);

      if (table.syncSource) {
        const source = tables.get(table.syncSource.sourceTableId);
        expect(source?.baseId).toBe(table.syncSource.sourceApplicationId);
      }

      for (const field of table.fields) {
        const options = field.options || {};
        if (field.type === 'multipleRecordLinks') {
          expect(tables.has(options.linkedTableId)).toBe(true);
        }
        if (options.recordLinkFieldId) {
          const linkField = fieldsById.get(options.recordLinkFieldId);
          expect(linkField?.type).toBe('multipleRecordLinks');
          if (options.fieldIdInLinkedTable) {
            const linked = tables.get(linkField.options.linkedTableId).table;
            expect(linked.fields.some((f) => f.id === options.fieldIdInLinkedTable)).toBe(true);
          }
        }
      }
    }
  });

  it('finds a Product Catalog hub with mixed relationship types', () => {
    const bases = listDemoBases().map((b) => ({ ...b, schemaJson: JSON.stringify(getDemoBaseSchema(b.id)) }));
    const rels = detectRelationships(bases);

    expect(rels.length).toBeGreaterThanOrEqual(12);
    expect(new Set(rels.map((r) => r.type))).toEqual(new Set(['sync', 'link', 'structural']));

    const catalogId = bases.find((b) => b.name === 'Product Catalog').id;
    const catalogNeighbors = new Set(
      rels
        .filter((r) => r.sourceBaseId === catalogId || r.targetBaseId === catalogId)
        .map((r) => (r.sourceBaseId === catalogId ? r.targetBaseId : r.sourceBaseId)),
    );
    expect(catalogNeighbors.size).toBeGreaterThanOrEqual(4);
  });

  it('rejects unknown base ids', () => {
    expect(() => getDemoBaseSchema('appNope0000000000')).toThrow('Demo base not found');
    expect(() => getDemoBaseHistory('appNope0000000000')).toThrow('Demo base not found');
  });

  it('rejects path traversal attempts instead of reading files outside the fixtures folder', () => {
    expect(() => getDemoBaseSchema('../bases')).toThrow('Demo base not found');
    expect(() => getDemoBaseSchema('appDemoOrders0001/../../x')).toThrow('Demo base not found');
    expect(() => getDemoBaseHistory('../schemas/appDemoOrders0001')).toThrow('Demo base not found');
  });

  it('uses the reserved demo account id', () => {
    expect(DEMO_ACCOUNT_ID).toBe('demo');
    expect(typeof DemoAirtableClient).toBe('function');
  });
});
