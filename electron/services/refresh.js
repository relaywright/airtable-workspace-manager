/**
 * Schema refresh pipeline: fetches bases + schemas from Airtable (or the
 * demo client), detects cross-base relationships, and runs the scheduled
 * background refresh. Shared by electron/ipc/bases.js (refresh-schemas) and
 * electron/ipc/demo.js (enter-demo-mode).
 *
 * No behavior change from the versions previously inlined in main.js;
 * module-level globals were replaced with the shared appContext (ctx).
 */
const { database } = require('../database');
const { hasSchemaChanged } = require('../schemaDiff');
const { normalizeConvention, matchesConvention } = require('../namingConvention');
const { detectRelationships, getRelationshipStats } = require('../relationshipDetector');
const { shouldRunScheduledRefresh } = require('../demoMode');
const { logger } = require('../logger');

const SCHEDULE_INTERVALS = {
  off: 0,
  hourly: 3600000,
  daily: 86400000,
  weekly: 604800000,
};

/**
 * Load the user's configured naming convention from settings storage,
 * normalized to a well-formed NamingConvention (defaults to disabled).
 */
function loadNamingConvention() {
  try {
    const raw = database.getSetting('namingConvention');
    return normalizeConvention(raw ? JSON.parse(raw) : null);
  } catch (err) {
    logger.warn('Main', 'Malformed namingConvention setting, using default:', err.message);
    return normalizeConvention(null);
  }
}

/**
 * Fetch bases + schemas from the given client (real or demo) and detect
 * relationships. Shared by the refresh-schemas IPC handler and by
 * enter-demo-mode, which runs the same flow against a DemoAirtableClient.
 *
 * `ctx.syncInProgress` is the mutex read by demoMode's isSyncInProgress
 * guard, so it must stay set for the duration of the refresh.
 */
async function refreshAllSchemas(ctx, { onProgress } = {}) {
  const client = ctx.demoMode.pickClient(ctx.airtableClient);
  if (!client) {
    return { success: false, error: 'No API token configured' };
  }
  if (ctx.syncInProgress) {
    return { success: false, error: 'A sync is already in progress. Please wait for it to finish.' };
  }
  ctx.syncInProgress = true;
  try {
    // Use batch mode to avoid writing the entire DB to disk after every single operation
    database.beginBatch();
    const convention = loadNamingConvention();

    // First fetch all bases
    logger.debug('Main', 'Fetching bases list...');
    const bases = await client.listBases();
    logger.debug('Main', `Found ${bases.length} bases. Fetching schemas...`);
    let updatedCount = 0;
    let changedBases = [];
    let archivedBases = [];

    // Get IDs of bases that exist in Airtable
    const airtableBaseIds = new Set(bases.map((b) => b.id));

    // Archive bases that no longer exist in Airtable
    const localBaseIds = database.getAllBaseIds();
    for (const localId of localBaseIds) {
      if (!airtableBaseIds.has(localId)) {
        const localBase = database.getBase(localId);
        if (localBase && !localBase.isArchived) {
          logger.info('Main', `Archiving base no longer in Airtable: ${localBase.name}`);
          database.archiveBase(localId);
          archivedBases.push({ id: localId, name: localBase.name });
        }
      }
    }

    // Pre-load existing base data into a Map to avoid N individual DB queries
    const existingBasesMap = new Map();
    for (const b of database.getAllBases()) {
      existingBasesMap.set(b.id, b);
    }

    // Send initial progress to renderer
    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('sync-progress', {
        phase: 'fetching-schemas',
        current: 0,
        total: bases.length,
        baseName: '',
      });
    }
    onProgress?.({ phase: 'fetching-schemas', current: 0, total: bases.length, baseName: '' });

    // Fetch schemas concurrently (4 workers, rate-limited to 5 req/sec)
    await client.fetchSchemasConcurrently(bases, {
      concurrency: 4,
      onProgress: (current, total, baseName) => {
        logger.debug('Main', `[${current}/${total}] Fetched schema for: ${baseName}`);
        if (ctx.mainWindow) {
          ctx.mainWindow.webContents.send('sync-progress', {
            phase: 'fetching-schemas',
            current,
            total,
            baseName,
          });
        }
        onProgress?.({ phase: 'fetching-schemas', current, total, baseName });
      },
      onResult: (base, schema, error) => {
        if (error || !schema) return;

        const newSchemaJson = JSON.stringify(schema);
        const tableCount = schema.tables?.length || 0;
        let fieldCount = 0;
        for (const table of schema.tables || []) {
          fieldCount += table.fields?.length || 0;
        }

        // Check if schema has changed
        const existingBase = existingBasesMap.get(base.id);
        const oldSchemaJson = existingBase?.schemaJson;
        const schemaChanged = hasSchemaChanged(oldSchemaJson, newSchemaJson);

        if (schemaChanged && oldSchemaJson) {
          database.createSnapshot(base.id, oldSchemaJson);
          const retentionCount = parseInt(database.getSetting('snapshotRetention'), 10) || 10;
          database.cleanupOldSnapshots(base.id, retentionCount);
          changedBases.push({ id: base.id, name: base.name });
          logger.info('Main', `Schema changed for: ${base.name}`);
        }

        const matches = matchesConvention(base.name, convention);

        database.upsertBase({
          id: base.id,
          name: base.name,
          permissionLevel: base.permissionLevel,
          matchesConvention: matches,
          schemaJson: newSchemaJson,
          tableCount,
          fieldCount,
        });

        updatedCount++;
      },
    });

    // After fetching schemas, detect cross-base relationships
    logger.debug('Main', 'Detecting cross-base relationships...');
    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('sync-progress', {
        phase: 'detecting-relationships',
        current: 0,
        total: 0,
        baseName: '',
      });
    }
    onProgress?.({ phase: 'detecting-relationships', current: 0, total: 0, baseName: '' });
    const allBases = database.getAllBases();
    logger.debug('Main', `Loaded ${allBases.length} bases from database for relationship detection`);

    // Load detection sensitivity settings
    const structuralThreshold = parseFloat(database.getSetting('structuralThreshold')) || 0.7;
    const confirmedThreshold = parseFloat(database.getSetting('confirmedThreshold')) || 0.9;
    const relationships = detectRelationships(allBases, { structuralThreshold, confirmedThreshold });
    const stats = getRelationshipStats(relationships);
    logger.info(
      'Main',
      `Found ${stats.total} relationships (${stats.confirmed} confirmed, ${stats.suspected} suspected)`,
    );
    logger.debug(
      'Main',
      `By type: sync=${stats.byType.sync}, link=${stats.byType.link}, structural=${stats.byType.structural}`,
    );

    // Clear old relationships and insert new ones
    database.clearRelationships();
    let insertedCount = 0;
    for (const rel of relationships) {
      const result = database.insertRelationship(rel);
      if (result.changes > 0) insertedCount++;
    }
    logger.debug('Main', `Inserted ${insertedCount} relationships into database`);

    // Verify what was stored
    const storedRelationships = database.getAllRelationships();
    logger.debug('Main', `Verified: ${storedRelationships.length} relationships now in database`);

    // Save database once after all operations complete
    database.endBatch();

    return {
      success: true,
      basesUpdated: updatedCount,
      relationshipsDetected: stats.total,
      changedBases,
      archivedBases,
    };
  } catch (error) {
    // Whole operation failed -- roll back instead of committing partial
    // writes (e.g. relationships cleared but not all reinserted, or some
    // bases updated and others not) while reporting failure to the caller.
    database.rollbackBatch();
    return { success: false, error: error.message };
  } finally {
    ctx.syncInProgress = false;
  }
}

/**
 * Run scheduled schema refresh in the background.
 * Sends progress events to the renderer so the UI can reflect the sync.
 */
async function runScheduledRefresh(ctx) {
  if (
    !shouldRunScheduledRefresh({
      hasClient: !!ctx.airtableClient,
      syncInProgress: ctx.syncInProgress,
      demoActive: ctx.demoMode.isActive(),
    })
  ) {
    if (ctx.demoMode.isActive()) {
      logger.info('Scheduler', 'Skipping scheduled refresh: demo mode is active');
    } else if (!ctx.airtableClient) {
      logger.info('Scheduler', 'Skipping scheduled refresh: no API token configured');
    } else {
      logger.info('Scheduler', 'Skipping scheduled refresh: sync already in progress');
    }
    return;
  }
  ctx.syncInProgress = true;
  logger.info('Scheduler', 'Starting scheduled schema refresh...');
  if (ctx.mainWindow) {
    ctx.mainWindow.webContents.send('scheduled-refresh-started');
  }
  try {
    // Re-use the same logic as the 'refresh-schemas' handler
    database.beginBatch();
    const convention = loadNamingConvention();
    const bases = await ctx.airtableClient.listBases();
    let updatedCount = 0;
    let changedBases = [];

    const airtableBaseIds = new Set(bases.map((b) => b.id));
    const localBaseIds = database.getAllBaseIds();
    for (const localId of localBaseIds) {
      if (!airtableBaseIds.has(localId)) {
        const localBase = database.getBase(localId);
        if (localBase && !localBase.isArchived) {
          database.archiveBase(localId);
        }
      }
    }

    const existingBasesMap = new Map();
    for (const b of database.getAllBases()) {
      existingBasesMap.set(b.id, b);
    }

    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('sync-progress', {
        phase: 'fetching-schemas',
        current: 0,
        total: bases.length,
        baseName: '',
      });
    }

    await ctx.airtableClient.fetchSchemasConcurrently(bases, {
      concurrency: 4,
      onProgress: (current, total, baseName) => {
        if (ctx.mainWindow) {
          ctx.mainWindow.webContents.send('sync-progress', {
            phase: 'fetching-schemas',
            current,
            total,
            baseName,
          });
        }
      },
      onResult: (base, schema, error) => {
        if (error || !schema) return;
        const newSchemaJson = JSON.stringify(schema);
        const tableCount = schema.tables?.length || 0;
        let fieldCount = 0;
        for (const table of schema.tables || []) {
          fieldCount += table.fields?.length || 0;
        }
        const existingBase = existingBasesMap.get(base.id);
        const oldSchemaJson = existingBase?.schemaJson;
        const schemaChanged = hasSchemaChanged(oldSchemaJson, newSchemaJson);
        if (schemaChanged && oldSchemaJson) {
          database.createSnapshot(base.id, oldSchemaJson);
          const retentionCount = parseInt(database.getSetting('snapshotRetention'), 10) || 10;
          database.cleanupOldSnapshots(base.id, retentionCount);
          changedBases.push({ id: base.id, name: base.name });
        }
        const matches = matchesConvention(base.name, convention);
        database.upsertBase({
          id: base.id,
          name: base.name,
          permissionLevel: base.permissionLevel,
          matchesConvention: matches,
          schemaJson: newSchemaJson,
          tableCount,
          fieldCount,
        });
        updatedCount++;
      },
    });

    // Detect relationships
    const allBases = database.getAllBases();
    const structuralThreshold = parseFloat(database.getSetting('structuralThreshold')) || 0.7;
    const confirmedThreshold = parseFloat(database.getSetting('confirmedThreshold')) || 0.9;
    const relationships = detectRelationships(allBases, { structuralThreshold, confirmedThreshold });
    database.clearRelationships();
    for (const rel of relationships) {
      database.insertRelationship(rel);
    }
    database.endBatch();

    // Update last sync time
    ctx.store.set('lastSync', new Date().toISOString());

    logger.info(
      'Scheduler',
      `Refresh complete. ${updatedCount} bases updated, ${changedBases.length} changed.`,
    );
    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('scheduled-refresh-completed', {
        basesUpdated: updatedCount,
        changedBases,
      });
    }
  } catch (err) {
    // Whole operation failed -- discard any partial writes from this batch
    // (e.g. relationships cleared but not all reinserted) instead of
    // committing them while reporting failure to the renderer.
    database.rollbackBatch();
    logger.error('Scheduler', 'Refresh failed:', err.message);
    if (ctx.mainWindow) {
      ctx.mainWindow.webContents.send('scheduled-refresh-completed', {
        error: err.message,
      });
    }
  } finally {
    ctx.syncInProgress = false;
  }
}

/**
 * Start or restart the scheduled refresh timer based on the stored setting.
 */
function startScheduleTimer(ctx, interval) {
  if (ctx.scheduleTimer) {
    clearInterval(ctx.scheduleTimer);
    ctx.scheduleTimer = null;
  }
  const ms = SCHEDULE_INTERVALS[interval];
  if (ms && ms > 0) {
    logger.info('Scheduler', `Setting refresh interval: ${interval} (${ms}ms)`);
    ctx.scheduleTimer = setInterval(() => runScheduledRefresh(ctx), ms);
  } else {
    logger.info('Scheduler', 'Scheduled refresh disabled');
  }
}

module.exports = {
  SCHEDULE_INTERVALS,
  loadNamingConvention,
  refreshAllSchemas,
  runScheduledRefresh,
  startScheduleTimer,
};
