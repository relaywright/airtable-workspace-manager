/**
 * Schema snapshot / history IPC handlers.
 */
const { database } = require('../database');
const { calculateSchemaDiff } = require('../schemaDiff');

function register(ipcMain, _ctx) {
  ipcMain.handle('get-snapshots', async (event, baseId, limit = 10) => {
    try {
      const snapshots = database.getSnapshots(baseId, limit);
      return { success: true, data: snapshots };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-all-snapshots', async (event, limit = 100) => {
    try {
      const snapshots = database.getAllSnapshots(limit);
      return { success: true, data: snapshots };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('compare-snapshots', async (event, baseId, snapshotId1, snapshotId2) => {
    try {
      // If snapshotId2 is null, compare snapshotId1 with current schema
      let oldSchemaJson, newSchemaJson;

      if (snapshotId1 === 'current') {
        const base = database.getBase(baseId);
        oldSchemaJson = base?.schemaJson;
      } else {
        const snapshots = database.getSnapshots(baseId, 100);
        const snapshot1 = snapshots.find((s) => s.id === snapshotId1);
        oldSchemaJson = snapshot1?.schemaJson;
      }

      if (snapshotId2 === 'current') {
        const base = database.getBase(baseId);
        newSchemaJson = base?.schemaJson;
      } else {
        const snapshots = database.getSnapshots(baseId, 100);
        const snapshot2 = snapshots.find((s) => s.id === snapshotId2);
        newSchemaJson = snapshot2?.schemaJson;
      }

      if (!oldSchemaJson || !newSchemaJson) {
        return { success: false, error: 'Could not find schemas to compare' };
      }

      const oldSchema = JSON.parse(oldSchemaJson);
      const newSchema = JSON.parse(newSchemaJson);
      const diff = calculateSchemaDiff(oldSchema, newSchema);

      return { success: true, data: diff };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
