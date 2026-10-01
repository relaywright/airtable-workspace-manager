/**
 * Dependency / impact analysis and health dashboard IPC handlers.
 */
const { database } = require('../database');
const {
  getImpactReport,
  detectCircularDependencies,
  traceSyncChains,
  classifyBases,
} = require('../dependencyAnalyzer');
const { readLastSync } = require('../demoMode');

function register(ipcMain, ctx) {
  ipcMain.handle('get-impact-report', async (event, baseId) => {
    try {
      const relationships = database.getAllRelationships();
      const bases = database.getAllBasesLite();
      const report = getImpactReport(baseId, relationships, bases);
      return { success: true, data: report };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detect-circular-deps', async () => {
    try {
      const relationships = database.getAllRelationships();
      const cycles = detectCircularDependencies(relationships);
      return { success: true, data: cycles };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('trace-sync-chains', async () => {
    try {
      const relationships = database.getAllRelationships();
      const chains = traceSyncChains(relationships);
      return { success: true, data: chains };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('classify-bases', async () => {
    try {
      const relationships = database.getAllRelationships();
      const classification = classifyBases(relationships);
      return { success: true, data: classification };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Health dashboard stats
  ipcMain.handle('get-health-stats', async () => {
    try {
      const bases = database.getAllBasesLite();
      const relationships = database.getAllRelationships();
      const snapshots = database.getAllSnapshots(1000);

      // Overview stats
      let totalTables = 0;
      let totalFields = 0;
      for (const b of bases) {
        totalTables += b.tableCount || 0;
        totalFields += b.fieldCount || 0;
      }
      const lastSyncTime = readLastSync(ctx);

      // Change summary from snapshots
      const now = new Date();
      const sevenDaysAgo = new Date(now - 7 * 86400000);
      const thirtyDaysAgo = new Date(now - 30 * 86400000);
      const changedLast7 = new Set();
      const changedLast30 = new Set();
      const snapshotCountByBase = {};

      for (const snap of snapshots) {
        const snapDate = new Date(snap.pulledAt);
        const baseId = snap.baseId;
        snapshotCountByBase[baseId] = (snapshotCountByBase[baseId] || 0) + 1;
        if (snapDate >= sevenDaysAgo) changedLast7.add(baseId);
        if (snapDate >= thirtyDaysAgo) changedLast30.add(baseId);
      }

      // Relationship health
      const relByType = { sync: 0, link: 0, structural: 0, other: 0 };
      const relByConfidence = { confirmed: 0, suspected: 0 };
      for (const rel of relationships) {
        const type = rel.type || 'other';
        if (Object.prototype.hasOwnProperty.call(relByType, type)) {
          relByType[type]++;
        } else {
          relByType.other++;
        }
        if (rel.confidence === 'confirmed') relByConfidence.confirmed++;
        else relByConfidence.suspected++;
      }

      // Circular dependencies
      const cycles = detectCircularDependencies(relationships);
      const circularCount = cycles.length;

      // Top changers (5 bases with most snapshots)
      const topChangers = Object.entries(snapshotCountByBase)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([baseId, count]) => {
          const base = bases.find((b) => b.id === baseId);
          return { baseId, baseName: base?.name || baseId, snapshotCount: count };
        });

      // Schema complexity
      let largestBase = null;
      let largestTableCount = 0;
      let mostConnectedBase = null;
      let mostConnections = 0;
      const connectionCount = {};

      for (const b of bases) {
        if ((b.tableCount || 0) > largestTableCount) {
          largestTableCount = b.tableCount || 0;
          largestBase = { id: b.id, name: b.name, tableCount: b.tableCount };
        }
      }

      for (const rel of relationships) {
        connectionCount[rel.sourceBaseId] = (connectionCount[rel.sourceBaseId] || 0) + 1;
        connectionCount[rel.targetBaseId] = (connectionCount[rel.targetBaseId] || 0) + 1;
      }

      for (const [baseId, count] of Object.entries(connectionCount)) {
        if (count > mostConnections) {
          mostConnections = count;
          const base = bases.find((b) => b.id === baseId);
          mostConnectedBase = { id: baseId, name: base?.name || baseId, connections: count };
        }
      }

      const avgFieldsPerTable = totalTables > 0 ? Math.round(totalFields / totalTables) : 0;

      // Anomaly indicators
      const anomalies = [];
      for (const b of bases) {
        const flags = [];
        if ((b.tableCount || 0) > 50) flags.push('50+ tables');
        if ((b.fieldCount || 0) > 500) flags.push('500+ fields');
        if ((connectionCount[b.id] || 0) > 10) flags.push('10+ connections');
        if (flags.length > 0) {
          anomalies.push({ baseId: b.id, baseName: b.name, flags });
        }
      }

      return {
        success: true,
        data: {
          overview: {
            totalBases: bases.length,
            totalTables,
            totalFields,
            totalRelationships: relationships.length,
            lastSyncTime,
          },
          changes: {
            last7Days: changedLast7.size,
            last30Days: changedLast30.size,
          },
          relationshipHealth: {
            byType: relByType,
            byConfidence: relByConfidence,
            circularCount,
          },
          topChangers,
          complexity: {
            avgFieldsPerTable,
            largestBase,
            mostConnectedBase,
          },
          anomalies,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
