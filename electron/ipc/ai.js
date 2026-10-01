/**
 * AI-powered schema intelligence IPC handlers.
 */
const { database } = require('../database');
const { analyzeBase, analyzeWorkspace, generateDocumentation, testApiKey } = require('../aiAnalyzer');
const { getAnthropicKey, setAnthropicKey, lastFour } = require('../store');

// The saved key never leaves the main process; the renderer only sees a masked summary.
function register(ipcMain) {
  ipcMain.handle('get-ai-key', () => {
    const key = getAnthropicKey();
    return { hasKey: !!key, last4: lastFour(key) };
  });

  ipcMain.handle('set-ai-key', async (event, key) => {
    try {
      if (typeof key !== 'string') {
        return { success: false, error: 'Please enter a key' };
      }
      setAnthropicKey(key.trim());
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Called with a newly typed key, or with no argument to test the saved one.
  ipcMain.handle('test-ai-key', async (event, key) => {
    try {
      const candidate = typeof key === 'string' && key.trim() ? key.trim() : getAnthropicKey();
      if (!candidate) {
        return { success: false, error: 'No key saved yet' };
      }
      const result = await testApiKey(candidate);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('analyze-base', async (event, baseId) => {
    try {
      const apiKey = getAnthropicKey();
      if (!apiKey) return { success: false, error: 'No Anthropic API key configured. Add one in Settings.' };

      const base = database.getBase(baseId);
      if (!base || !base.schemaJson)
        return { success: false, error: 'No schema data available for this base.' };

      const schema = JSON.parse(base.schemaJson);
      const result = await analyzeBase(schema, apiKey, database, baseId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('analyze-workspace', async () => {
    try {
      const apiKey = getAnthropicKey();
      if (!apiKey) return { success: false, error: 'No Anthropic API key configured. Add one in Settings.' };

      const allBases = database.getAllBases();
      const relationships = database.getAllRelationships();
      const result = await analyzeWorkspace(allBases, relationships, apiKey, database);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('generate-documentation', async (event, baseId) => {
    try {
      const apiKey = getAnthropicKey();
      if (!apiKey) return { success: false, error: 'No Anthropic API key configured. Add one in Settings.' };

      const base = database.getBase(baseId);
      if (!base || !base.schemaJson)
        return { success: false, error: 'No schema data available for this base.' };

      const schema = JSON.parse(base.schemaJson);
      const result = await generateDocumentation(schema, apiKey, database, baseId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
