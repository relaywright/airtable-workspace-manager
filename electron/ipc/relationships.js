/**
 * Cross-base relationship IPC handlers.
 */
const { database } = require('../database');
const { detectRelationships, getRelationshipStats } = require('../relationshipDetector');
const { logger } = require('../logger');

function register(ipcMain, _ctx) {
  ipcMain.handle('get-relationships', async () => {
    try {
      const relationships = database.getAllRelationships();
      return { success: true, data: relationships };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detect-relationships', async () => {
    try {
      logger.debug('Relationships', 'Detecting cross-base relationships...');
      const allBases = database.getAllBases();
      const structuralThreshold = parseFloat(database.getSetting('structuralThreshold')) || 0.7;
      const confirmedThreshold = parseFloat(database.getSetting('confirmedThreshold')) || 0.9;
      const relationships = detectRelationships(allBases, { structuralThreshold, confirmedThreshold });
      const stats = getRelationshipStats(relationships);
      logger.info(
        'Relationships',
        `Found ${stats.total} relationships (${stats.confirmed} confirmed, ${stats.suspected} suspected)`,
      );

      // Clear old relationships and insert new ones (batch to save once)
      database.beginBatch();
      database.clearRelationships();
      for (const rel of relationships) {
        database.insertRelationship(rel);
      }
      database.endBatch();

      // Return updated relationships from DB
      const savedRelationships = database.getAllRelationships();
      return {
        success: true,
        data: savedRelationships,
        stats,
      };
    } catch (error) {
      logger.error('Relationships', 'Error detecting relationships:', error);
      // Whole operation failed -- discard any partial relationship writes
      // instead of committing them while reporting failure.
      database.rollbackBatch();
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update-relationship', async (event, id, updates) => {
    try {
      database.updateRelationship(id, updates);
      const updated = database.getRelationship(id);
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
