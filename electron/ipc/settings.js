/**
 * App settings, naming convention, and misc data-management IPC handlers.
 */
const { database } = require('../database');
const { normalizeConvention, recomputeConventionMatches } = require('../namingConvention');
const { loadNamingConvention } = require('../services/refresh');
const { readLastSync, writeLastSync } = require('../demoMode');

function register(ipcMain, ctx) {
  ipcMain.handle('clear-data', async () => {
    try {
      database.clearAllData();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Settings management
  ipcMain.handle('get-setting', async (event, key) => {
    try {
      const value = database.getSetting(key);
      return { success: true, data: value };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-setting', async (event, key, value) => {
    try {
      database.setSetting(key, value);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-all-settings', async () => {
    try {
      const settings = database.getAllSettings();
      return { success: true, data: settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Naming convention (getter returns the raw NamingConvention value)
  ipcMain.handle('get-naming-convention', () => {
    return loadNamingConvention();
  });

  ipcMain.handle('set-naming-convention', async (event, convention) => {
    try {
      const normalized = normalizeConvention(convention);
      database.setSetting('namingConvention', JSON.stringify(normalized));

      // Recompute matches_convention for every stored base under the new convention
      recomputeConventionMatches(database, normalized);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-last-sync', async () => {
    try {
      return { success: true, data: readLastSync(ctx) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-last-sync', async (event, timestamp) => {
    try {
      writeLastSync(ctx, timestamp);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
