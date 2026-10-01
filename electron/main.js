const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { logger } = require('./logger');
const { initDatabase, database, getDatabasePath, switchDatabase } = require('./database');
const { createStore, createSafeStorageCodec, getActiveAccount, getActiveToken } = require('./store');
const { isAllowedExternalUrl, isAppUrl } = require('./externalLinks');
const { AirtableClient } = require('./airtableClient');
const { recomputeConventionMatches } = require('./namingConvention');
const { createAppContext } = require('./appContext');
const { loadNamingConvention, startScheduleTimer } = require('./services/refresh');
const { registerAll } = require('./ipc');

let mainWindow;

const ctx = createAppContext({
  getActiveAccountId: () => {
    const account = getActiveAccount();
    return account ? account.id : null;
  },
  switchDatabase,
  getBackupRoot: () => path.join(app.getPath('userData'), 'backups'),
});

const isDev = !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:5174';
const APP_ENTRY_FILE = path.join(__dirname, '../dist/index.html');

// The only origin allowed to host the app page and call IPC handlers. In the
// packaged build this is the exact file URL of the entry HTML file (not a bare
// 'file://'), so isAppUrl can reject other local HTML files that also use the
// file: protocol.
ctx.appOrigin = isDev ? new URL(DEV_SERVER_URL).origin : pathToFileURL(APP_ENTRY_FILE).href;

// ── Global crash handlers ──────────────────────────────────────────────
// Prevent the app from silently dying on unhandled errors.
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Main', 'Unhandled Promise Rejection:', reason);
  if (mainWindow) {
    mainWindow.webContents.send('main-process-error', {
      message: `Unexpected error: ${reason?.message || reason}`,
    });
  }
});

process.on('uncaughtException', (error) => {
  logger.error('Main', 'Uncaught Exception:', error);
  // Try to notify the renderer before things get worse
  if (mainWindow) {
    try {
      mainWindow.webContents.send('main-process-error', {
        message: `Critical error: ${error.message}`,
      });
    } catch (sendErr) {
      logger.warn(
        'Main',
        'Could not notify renderer of uncaught exception (renderer likely gone):',
        sendErr.message,
      );
    }
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0f0f1a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });
  ctx.mainWindow = mainWindow;

  // Links never open inside the app. Allowlisted https links go to the system
  // browser; everything else is dropped.
  const openInBrowserIfAllowed = (url) => {
    if (!isAllowedExternalUrl(url)) {
      logger.warn('Main', 'Blocked link to a site outside the allowlist:', url);
      return;
    }
    shell.openExternal(url).catch((err) => {
      logger.error('Main', 'Could not open link in the browser:', err.message);
    });
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowserIfAllowed(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, ctx.appOrigin)) return;
    event.preventDefault();
    openInBrowserIfAllowed(url);
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(APP_ENTRY_FILE);
  }

  // Forward renderer console messages to the terminal at their own level. Take
  // only the event object: declaring the old positional (level, message) args
  // makes Electron print a deprecation warning on every launch.
  mainWindow.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') {
      logger.error('Renderer', message);
    } else if (level === 'warning') {
      logger.warn('Renderer', message);
    } else if (level === 'info') {
      logger.info('Renderer', message);
    } else {
      logger.debug('Renderer', message);
    }
  });

  // Detect renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error('Main', 'Renderer process gone:', details.reason, details.exitCode);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    ctx.mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // app.quit() (called above when the lock wasn't obtained) only requests a
  // quit -- it does not synchronously stop this already-registered
  // whenReady() callback from firing. Guard explicitly so a second instance
  // never initializes its own database handle or window.
  if (!app.hasSingleInstanceLock()) {
    return;
  }

  // Initialize store (migrates single-token configs to multi-account, then
  // encrypts any plaintext secrets with the OS keychain via safeStorage)
  ctx.store = createStore({ codec: createSafeStorageCodec(safeStorage) });

  // Expose the Electron APIs IPC modules are allowed to use.
  ctx.electron = { dialog, shell, app };

  // Initialize database for the active account
  const activeAccount = getActiveAccount();
  if (activeAccount) {
    await initDatabase(getDatabasePath(activeAccount.id));
  } else {
    // No accounts yet -- use default database path
    await initDatabase();
  }

  // Recompute matches_convention for databases that predate the column (the
  // migration in database.js adds the column but can only default it to 0).
  try {
    recomputeConventionMatches(database, loadNamingConvention());
  } catch (err) {
    logger.error('Main', 'Failed to recompute naming convention matches on startup:', err.message);
  }

  // Initialize Airtable client with the active account's token
  const token = getActiveToken();
  if (token) {
    ctx.setAirtableClient(new AirtableClient(token));
  }

  // Start scheduled refresh if configured
  const schedule = database.getSetting('refreshSchedule') || 'off';
  startScheduleTimer(ctx, schedule);

  registerAll(ipcMain, ctx);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  ctx.backup.close();
});

module.exports = { createWindow };
