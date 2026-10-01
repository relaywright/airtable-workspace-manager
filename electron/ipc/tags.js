/**
 * Base tag IPC handlers.
 */
const { database } = require('../database');

function register(ipcMain, _ctx) {
  ipcMain.handle('update-base-tags', async (event, baseId, tags) => {
    try {
      database.updateBaseTags(baseId, tags);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-all-tags', async () => {
    try {
      const tags = database.getAllTags();
      return { success: true, data: tags };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rename-tag', async (event, oldName, newName) => {
    try {
      const result = database.renameTag(oldName, newName);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-tag', async (event, tagName) => {
    try {
      const result = database.deleteTag(tagName);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
