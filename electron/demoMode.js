/**
 * Demo mode: isolates the fictional "Cedar & Pine Goods" demo workspace from
 * a user's real Airtable accounts.
 *
 * Does not require `electron` so it can be unit-tested with plain fakes.
 */
const { DemoAirtableClient } = require('./demoWorkspace');

/**
 * @param {Object} deps
 * @param {(accountId: string|null) => Promise<void>} deps.switchDatabase - swaps the open SQLite file (electron/database.js).
 * @param {() => string|null} deps.getActiveAccountId - id of the currently active real account, or null.
 * @param {() => boolean} deps.isSyncInProgress - whether a schema sync/refresh is currently running.
 */
function createDemoMode({ switchDatabase, getActiveAccountId, isSyncInProgress }) {
  let active = false;
  let previousAccountId = null;
  // When the demo data last loaded. Memory only, never the shared store, so
  // demo activity can't overwrite a real account's last sync time.
  let lastSyncAt = null;

  return {
    isActive() {
      return active;
    },

    getPreviousAccountId() {
      return previousAccountId;
    },

    getLastSync() {
      return lastSyncAt;
    },

    recordSync(timestamp) {
      if (active) {
        lastSyncAt = timestamp;
      }
    },

    async enter() {
      if (active) {
        return { success: true };
      }
      if (isSyncInProgress()) {
        return { success: false, error: 'A sync or backup is in progress. Try again when it finishes.' };
      }

      const accountIdBeforeDemo = getActiveAccountId();
      try {
        await switchDatabase('demo');
      } catch (error) {
        // Stay inactive on failure; do not record previousAccountId.
        return { success: false, error: (error && error.message) || String(error) };
      }

      // Demo state lives in memory only. We deliberately never persist
      // 'demo' as the active account (e.g. via the store's active-account
      // setter), so that if the app crashes mid-demo, relaunching opens the
      // real account again instead of getting stuck in demo mode.
      previousAccountId = accountIdBeforeDemo;
      active = true;
      return { success: true };
    },

    async exit() {
      if (!active) {
        return { success: true };
      }

      try {
        await switchDatabase(previousAccountId || null);
      } catch (error) {
        return { success: false, error: (error && error.message) || String(error) };
      }

      active = false;
      previousAccountId = null;
      lastSyncAt = null;
      return { success: true };
    },

    pickClient(realClient) {
      return active ? new DemoAirtableClient() : realClient;
    },
  };
}

/**
 * Whether the background scheduled refresh should run. Extracted so it's
 * unit-testable without an Electron process or a live timer.
 */
function shouldRunScheduledRefresh({ hasClient, syncInProgress, demoActive }) {
  if (demoActive) return false;
  if (!hasClient) return false;
  if (syncInProgress) return false;
  return true;
}

/**
 * The "last synced" time to show: the demo's in-memory time while demo mode
 * is active, otherwise the real account's time from the store.
 * @param {{ demoMode: ReturnType<typeof createDemoMode>, store: { get: Function } }} ctx
 */
function readLastSync(ctx) {
  if (ctx.demoMode.isActive()) {
    return ctx.demoMode.getLastSync();
  }
  return ctx.store.get('lastSync') || null;
}

/**
 * Record a sync time without letting demo mode touch the real account's
 * stored value.
 * @param {{ demoMode: ReturnType<typeof createDemoMode>, store: { set: Function } }} ctx
 * @param {string} timestamp - ISO timestamp
 */
function writeLastSync(ctx, timestamp) {
  if (ctx.demoMode.isActive()) {
    ctx.demoMode.recordSync(timestamp);
  } else {
    ctx.store.set('lastSync', timestamp);
  }
}

module.exports = { createDemoMode, shouldRunScheduledRefresh, readLastSync, writeLastSync };
