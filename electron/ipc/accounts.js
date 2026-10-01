/**
 * Multi-account management and scheduled-refresh setting IPC handlers.
 */
const { database, switchDatabase } = require('../database');
const {
  getAccounts,
  getActiveToken,
  addAccount,
  removeAccount,
  getActiveAccount,
  setActiveAccount,
} = require('../store');
const { AirtableClient } = require('../airtableClient');
const { checkTokenShape } = require('../connectionErrors');
const { SCHEDULE_INTERVALS, startScheduleTimer } = require('../services/refresh');
const { logger } = require('../logger');

function register(ipcMain, ctx) {
  ipcMain.handle('get-accounts', async () => {
    try {
      const accounts = getAccounts();
      return { success: true, data: accounts };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-active-account', async () => {
    try {
      const account = getActiveAccount();
      return { success: true, data: account };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('add-account', async (event, name, token) => {
    try {
      if (typeof name !== 'string' || !name.trim() || typeof token !== 'string' || !token.trim()) {
        return { success: false, error: 'Please enter both a name and token for the new account' };
      }
      const trimmed = token.trim();
      const shapeProblem = checkTokenShape(trimmed);
      if (shapeProblem) return { success: false, error: shapeProblem, code: 'bad-token' };
      const check = await new AirtableClient(trimmed).testConnection();
      if (!check.success) return check;
      if (ctx.demoMode.isActive()) {
        await ctx.demoMode.exit();
      }
      const account = addAccount(name.trim(), trimmed);
      if (getActiveAccount()?.id === account.id) {
        const activeToken = getActiveToken();
        if (activeToken) ctx.setAirtableClient(new AirtableClient(activeToken));
      }
      return {
        success: true,
        data: {
          id: account.id,
          name: account.name,
          createdAt: account.createdAt,
          lastUsedAt: account.lastUsedAt,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('remove-account', async (event, accountId) => {
    try {
      if (ctx.syncInProgress) {
        return { success: false, error: 'Cannot remove accounts while a sync is in progress. Please wait.' };
      }
      if (ctx.demoMode.isActive()) {
        await ctx.demoMode.exit();
      }

      const accounts = getAccounts();
      if (accounts.length <= 1) {
        return { success: false, error: 'Cannot remove the last account' };
      }
      const result = removeAccount(accountId);

      // If the active account changed, switch database
      const newActive = getActiveAccount();
      if (newActive) {
        try {
          await switchDatabase(newActive.id);
        } catch (dbError) {
          logger.error('Main', 'Failed to switch database after account removal:', dbError);
          return {
            success: false,
            error: `Account removed but failed to switch database: ${dbError.message}`,
          };
        }
        const token = getActiveToken();
        ctx.setAirtableClient(token ? new AirtableClient(token) : null);
        const schedule = database.getSetting('refreshSchedule') || 'off';
        startScheduleTimer(ctx, schedule);
      }

      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('switch-account', async (event, accountId) => {
    try {
      if (ctx.syncInProgress) {
        return { success: false, error: 'Cannot switch accounts while a sync is in progress. Please wait.' };
      }
      if (ctx.demoMode.isActive()) {
        await ctx.demoMode.exit();
      }

      const previousAccount = getActiveAccount();
      const account = setActiveAccount(accountId);

      // Switch database to the new account's database.
      // If this fails, we revert to the previous active account so the app
      // isn't left without a working database.
      try {
        await switchDatabase(accountId);
      } catch (dbError) {
        logger.error('Main', 'Failed to switch database, reverting:', dbError);
        // Revert the active account in the store
        if (previousAccount && previousAccount.id !== accountId) {
          setActiveAccount(previousAccount.id);
        }
        return { success: false, error: `Failed to switch database: ${dbError.message}` };
      }

      // Update Airtable client with the new account's token
      const token = getActiveToken();
      ctx.setAirtableClient(token ? new AirtableClient(token) : null);

      // Restart schedule timer for the new database's settings
      const schedule = database.getSetting('refreshSchedule') || 'off';
      startScheduleTimer(ctx, schedule);

      return { success: true, data: { id: account.id, name: account.name } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Scheduled refresh management
  ipcMain.handle('get-refresh-schedule', async () => {
    try {
      const schedule = database.getSetting('refreshSchedule') || 'off';
      return { success: true, data: schedule };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-refresh-schedule', async (event, interval) => {
    try {
      if (!Object.prototype.hasOwnProperty.call(SCHEDULE_INTERVALS, interval)) {
        return { success: false, error: `Invalid interval: ${interval}` };
      }
      database.setSetting('refreshSchedule', interval);
      startScheduleTimer(ctx, interval);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
