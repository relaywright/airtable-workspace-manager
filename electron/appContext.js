/**
 * Single mutable application context shared by all IPC modules.
 *
 * main.js creates one of these at startup and fills it in as app
 * initialization proceeds (store, database-backed demo mode, Airtable
 * client, main window, scheduled-refresh timer, and the Electron APIs
 * IPC modules are allowed to use). IPC modules read and write shared
 * state through this object instead of module-level globals in main.js.
 *
 * Does not require('electron') at the top level so it stays loadable in
 * plain Node/Vitest tests; `ctx.electron` is filled in by main.js with the
 * real { dialog, shell, app } once the Electron app is ready.
 */
const { createDemoMode } = require('./demoMode');
const { createBackupService } = require('./services/backup');
const { DEMO_ACCOUNT_ID } = require('./demoWorkspace');

/**
 * @param {Object} deps
 * @param {() => string|null} deps.getActiveAccountId - id of the currently active real account, or null.
 * @param {(accountId: string|null) => Promise<void>} deps.switchDatabase - swaps the open SQLite file (electron/database.js).
 * @param {() => string} [deps.getBackupRoot] - folder that holds every account's backup folder.
 */
function createAppContext({ getActiveAccountId, switchDatabase, getBackupRoot }) {
  const ctx = {
    store: null,
    airtableClient: null,
    mainWindow: null,
    scheduleTimer: null,
    syncInProgress: false, // Mutex to prevent concurrent sync/refresh operations
    electron: null, // filled in by main.js with { dialog, shell, app }
    setAirtableClient(client) {
      ctx.airtableClient = client;
    },
  };

  // Demo mode: lets a user explore a fictional workspace without an
  // Airtable account. Isolated to its own SQLite file (see electron/demoMode.js).
  ctx.demoMode = createDemoMode({
    switchDatabase,
    getActiveAccountId,
    isSyncInProgress: () => ctx.syncInProgress || ctx.backup.isRunning(),
  });

  // Backups: one store per account (or the demo), one run at a time.
  ctx.backup = createBackupService({
    getRootFolder: () => {
      if (!getBackupRoot) throw new Error('No backup folder is configured');
      return getBackupRoot();
    },
    getAccountKey: () => (ctx.demoMode.isActive() ? DEMO_ACCOUNT_ID : getActiveAccountId() || 'default'),
  });

  return ctx;
}

module.exports = { createAppContext };
