/**
 * Owns the backup store for whichever account is active (or the demo), and
 * makes sure only one backup runs at a time.
 *
 * Each account gets its own folder under the backup root. When the active
 * account changes mid-run, the running backup keeps its own store handle
 * until it finishes, and that handle is closed afterwards.
 *
 * Does not require('electron'); main.js supplies the folder and account key.
 */
const fs = require('fs');
const path = require('path');
const { openBackupStore } = require('../backup/backupStore');
const { createFileStore } = require('../backup/fileStore');
const { runBackup } = require('../backup/backupEngine');
const { describeBackupError } = require('../backup/backupErrors');
const { logger } = require('../logger');

const BUSY_ERROR = 'A backup is already running. Wait for it to finish, then try again.';

// Storage failures reach the Backups screen, so they are rethrown in plain
// words; the original error stays attached as the cause for the logs.
function plainStorageError(err, fallbackMessage) {
  const description = describeBackupError(err);
  const message = description.code === 'disk-full' ? description.message : fallbackMessage;
  return new Error(message, { cause: err });
}

function safeFolderName(key) {
  return String(key || 'default').replace(/[^A-Za-z0-9_-]/g, '_');
}

function createBackupService({ getRootFolder, getAccountKey }) {
  let current = null;
  let running = null;

  function folderFor(key) {
    return path.join(getRootFolder(), safeFolderName(key));
  }

  function open() {
    const key = getAccountKey();
    const folder = folderFor(key);
    try {
      if (running && running.key === key) {
        if (current && current !== running) {
          current.store.close();
          current = null;
        }
        current = running;
        return current;
      }
      if (current && current.key === key) return current;
      if (current && current !== running) current.store.close();
      current = null;

      const store = openBackupStore(folder);
      try {
        const interrupted = store.discardInterruptedRuns(new Date().toISOString());
        if (interrupted.length > 0) {
          logger.warn(
            'Backup',
            `Discarded ${interrupted.length} backup run(s) that the app closed before finishing`,
          );
        }
        current = { key, folder, store, files: createFileStore(folder) };
      } catch (err) {
        store.close();
        throw err;
      }
      return current;
    } catch (err) {
      logger.error('Backup', 'Could not open backups:', err.message);
      throw plainStorageError(
        err,
        `The app couldn't open your backups in ${folder}, so it can't show or add restore points right now. Check that the drive is connected, has free space, and that you can change files in that folder. Then open Backups again.`,
      );
    }
  }

  async function runNow({ client, bases, trigger = 'manual', onProgress }) {
    if (running) return { success: false, error: BUSY_ERROR };
    if (!client) return { success: false, error: 'Connect an Airtable token first, then run the backup.' };

    let handle;
    try {
      handle = open();
      running = handle;
      const results = await runBackup({
        client,
        store: handle.store,
        files: handle.files,
        bases,
        trigger,
        onProgress,
      });
      return { success: true, data: { results } };
    } catch (err) {
      logger.error('Backup', 'Backup stopped unexpectedly:', err.message);
      return {
        success: false,
        error: handle ? `The backup stopped unexpectedly: ${err.message}` : err.message,
      };
    } finally {
      running = null;
      if (handle && current !== handle) handle.store.close();
    }
  }

  function readBackups(handle, read) {
    try {
      return read();
    } catch (err) {
      logger.error('Backup', 'Could not read backups:', err.message);
      throw plainStorageError(
        err,
        `The app couldn't read your backups in ${handle.folder} right now. Check that the drive is connected, then open Backups again.`,
      );
    }
  }

  function getOverview(bases) {
    const handle = open();
    return readBackups(handle, () => ({
      folder: handle.folder,
      isRunning: !!running,
      bases: bases.map((base) => ({
        baseId: base.id,
        baseName: base.name,
        ...handle.store.getBaseSummary(base.id),
      })),
    }));
  }

  function getRestorePoints(baseId) {
    const handle = open();
    return readBackups(handle, () => handle.store.listRestorePoints(baseId));
  }

  // Deletes an account's backup folder. Only used to rebuild the demo's.
  function resetFolder(key) {
    if (running) throw new Error(BUSY_ERROR);
    if (current && current.key === key) {
      current.store.close();
      current = null;
    }
    fs.rmSync(folderFor(key), { recursive: true, force: true });
  }

  function close() {
    if (current && current !== running) {
      current.store.close();
      current = null;
    }
  }

  return {
    open,
    runNow,
    getOverview,
    getRestorePoints,
    resetFolder,
    isRunning: () => !!running,
    close,
  };
}

module.exports = { createBackupService };
