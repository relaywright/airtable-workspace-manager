/**
 * Demo mode IPC handlers: explore a fictional workspace without an
 * Airtable account.
 */
const { database } = require('../database');
const { seedDemoHistory } = require('../demoHistory');
const { seedDemoBackups } = require('../demoBackups');
const { DEMO_ACCOUNT_ID } = require('../demoWorkspace');
const { refreshAllSchemas } = require('../services/refresh');
const { logger } = require('../logger');

function register(ipcMain, ctx) {
  ipcMain.handle('enter-demo-mode', async () => {
    const enterResult = await ctx.demoMode.enter();
    if (!enterResult.success) {
      return enterResult;
    }

    const refreshResult = await refreshAllSchemas(ctx);
    if (!refreshResult.success) {
      await ctx.demoMode.exit();
      return { success: false, error: refreshResult.error };
    }

    // The demo database is open now. Backfill a few weeks of schema history
    // so Change Log, History, and Health have something to show; the demo
    // is still usable without it, so a failure here doesn't block entry.
    try {
      seedDemoHistory(database);
    } catch (error) {
      logger.error('Demo', 'Could not seed demo schema history:', error.message);
    }

    // Build a few weeks of backup history too, so the Backups view has
    // restore points to explore. Rebuilt on every entry so it always matches
    // the fixtures; like schema history, a failure doesn't block entry.
    try {
      ctx.backup.resetFolder(DEMO_ACCOUNT_ID);
      const { store, files } = ctx.backup.open();
      await seedDemoBackups({ store, files });
    } catch (error) {
      logger.error('Demo', 'Could not build demo backups:', error.message);
    }
    ctx.demoMode.recordSync(new Date().toISOString());
    return { success: true };
  });

  ipcMain.handle('exit-demo-mode', async () => {
    return ctx.demoMode.exit();
  });

  ipcMain.handle('is-demo-mode', () => {
    return ctx.demoMode.isActive();
  });
}

module.exports = { register };
