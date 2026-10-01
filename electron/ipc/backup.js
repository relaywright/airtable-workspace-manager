/**
 * Backup IPC handlers: run a backup now, and read backup status and restore
 * points for the Backups view.
 */
const { database } = require('../database');
const { listDemoRecordBaseIds } = require('../demoWorkspace');

// The bases a backup covers: every active base, or in sample-data mode the
// demo bases that have records.
function backupTargets(ctx) {
  const bases = database.getAllBasesLite(false).map((base) => ({ id: base.id, name: base.name }));
  if (!ctx.demoMode.isActive()) return bases;
  const withRecords = new Set(listDemoRecordBaseIds());
  return bases.filter((base) => withRecords.has(base.id));
}

function register(ipcMain, ctx) {
  ipcMain.handle('get-backup-overview', async () => {
    try {
      return { success: true, data: ctx.backup.getOverview(backupTargets(ctx)) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-restore-points', async (event, baseId) => {
    if (typeof baseId !== 'string' || !baseId) {
      return { success: false, error: 'Choose a base first.' };
    }
    try {
      return { success: true, data: ctx.backup.getRestorePoints(baseId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('backup-now', async () => {
    try {
      const bases = backupTargets(ctx);
      if (bases.length === 0) {
        return { success: false, error: 'There are no bases to back up yet. Refresh your workspace first.' };
      }
      return await ctx.backup.runNow({
        client: ctx.demoMode.pickClient(ctx.airtableClient),
        bases,
        onProgress: (progress) => {
          if (ctx.mainWindow) ctx.mainWindow.webContents.send('backup-progress', progress);
        },
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
