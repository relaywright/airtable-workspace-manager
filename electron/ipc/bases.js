/**
 * Base inventory + Airtable fetch/refresh IPC handlers.
 */
const { database } = require('../database');
const { loadNamingConvention, refreshAllSchemas } = require('../services/refresh');
const { matchesConvention } = require('../namingConvention');

function register(ipcMain, ctx) {
  ipcMain.handle('get-bases', async (event, includeArchived = true) => {
    try {
      const bases = database.getAllBasesLite(includeArchived);
      return { success: true, data: bases };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('archive-base', async (event, baseId) => {
    try {
      database.archiveBase(baseId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('unarchive-base', async (event, baseId) => {
    try {
      database.unarchiveBase(baseId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-base', async (event, baseId) => {
    try {
      const base = database.getBase(baseId);
      return { success: true, data: base };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Airtable API operations
  ipcMain.handle('fetch-all-bases', async () => {
    try {
      const client = ctx.demoMode.pickClient(ctx.airtableClient);
      if (!client) {
        return { success: false, error: 'No API token configured' };
      }

      const bases = await client.listBases();

      // Store bases in database (batch to avoid writing DB after each insert)
      database.beginBatch();
      const convention = loadNamingConvention();
      for (const base of bases) {
        const matches = matchesConvention(base.name, convention);
        database.upsertBase({
          id: base.id,
          name: base.name,
          permissionLevel: base.permissionLevel,
          matchesConvention: matches,
        });
      }
      database.endBatch();

      return { success: true, data: bases };
    } catch (error) {
      // Whole operation failed -- discard any bases already upserted this
      // batch instead of committing a partial write while reporting failure.
      database.rollbackBatch();
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fetch-base-schema', async (event, baseId) => {
    try {
      const client = ctx.demoMode.pickClient(ctx.airtableClient);
      if (!client) {
        return { success: false, error: 'No API token configured' };
      }

      const schema = await client.getBaseSchema(baseId);

      // Update base with schema
      const tableCount = schema.tables?.length || 0;
      let fieldCount = 0;
      for (const table of schema.tables || []) {
        fieldCount += table.fields?.length || 0;
      }

      database.updateBaseSchema(baseId, {
        schemaJson: JSON.stringify(schema),
        tableCount,
        fieldCount,
      });

      return { success: true, data: schema };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('refresh-schemas', async () => {
    return refreshAllSchemas(ctx);
  });

  ipcMain.handle('update-base-description', async (event, baseId, description) => {
    try {
      database.updateBaseDescription(baseId, description);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Schema search
  ipcMain.handle('search-schemas', async (event, query, options) => {
    try {
      const results = database.searchSchemas(query, options);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
