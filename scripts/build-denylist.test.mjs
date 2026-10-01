import { describe, it, expect } from 'vitest';
import { harvestIds } from './build-denylist.mjs';

describe('build-denylist', () => {
  it('harvests only ID-shaped string values from a schema object, never object keys', () => {
    // Made-up IDs (right shape: 3-letter prefix + 14 alphanumerics), never real ones.
    const tableId = 'tblA1B2C3D4E5F6G7';
    const fieldId = 'fldH8I9J0K1L2M3N4';
    const schema = {
      tables: [
        {
          id: tableId,
          name: 'Suppliers',
          options: { recordLinkFieldId: fieldId },
        },
      ],
    };

    const ids = harvestIds(schema);

    expect(ids).toEqual(new Set([tableId, fieldId]));
    // The object key itself ("recordLinkFieldId") must never be harvested, only its value.
    expect(ids.has('recordLinkFieldId')).toBe(false);
  });
});
