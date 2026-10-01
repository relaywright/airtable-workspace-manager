/**
 * Token management IPC handlers.
 *
 * The saved token never leaves the main process: the renderer only learns
 * whether one exists and its last four characters, for a masked display.
 */
const { AirtableClient } = require('../airtableClient');
const { checkTokenShape } = require('../connectionErrors');
const { getActiveToken, setActiveToken, lastFour } = require('../store');

function register(ipcMain, ctx) {
  ipcMain.handle('get-token', () => {
    const token = getActiveToken();
    return { hasToken: !!token, last4: lastFour(token) };
  });

  // Called with a newly typed token, or with no argument to activate the saved one.
  ipcMain.handle('set-token', async (event, token) => {
    try {
      // IPC may deliver a missing argument as null rather than undefined.
      const useSaved = token === undefined || token === null;
      if (!useSaved && (typeof token !== 'string' || !token.trim())) {
        return { success: false, error: 'Please enter a token' };
      }
      const candidate = useSaved ? getActiveToken() : token.trim();
      if (!candidate) {
        return { success: false, error: 'No token saved yet' };
      }
      let check = null;
      if (!useSaved) {
        const shapeProblem = checkTokenShape(candidate);
        if (shapeProblem) return { success: false, error: shapeProblem, code: 'bad-token' };
        // Only a token Airtable accepts gets saved; a rejected one leaves the old one in place.
        check = await new AirtableClient(candidate).testConnection();
        if (!check.success) return check;
      }
      if (ctx.demoMode.isActive()) {
        await ctx.demoMode.exit();
      }
      if (!useSaved) setActiveToken(candidate);
      ctx.setAirtableClient(new AirtableClient(candidate));
      // baseCount lets the setup screen warn about a token that can't see any bases.
      return check ? { success: true, baseCount: check.baseCount } : { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Called with a newly typed token, or with no argument to test the saved one.
  ipcMain.handle('test-connection', async (event, token) => {
    try {
      const candidate = typeof token === 'string' && token.trim() ? token.trim() : getActiveToken();
      if (!candidate) {
        return { success: false, error: 'No token saved yet' };
      }
      if (typeof token === 'string' && token.trim()) {
        const shapeProblem = checkTokenShape(candidate);
        if (shapeProblem) return { success: false, error: shapeProblem, code: 'bad-token' };
      }
      const client = new AirtableClient(candidate);
      const result = await client.testConnection();
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
