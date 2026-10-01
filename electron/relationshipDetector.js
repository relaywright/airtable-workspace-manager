/**
 * Relationship Detector
 * Analyzes base schemas to detect cross-base relationships:
 * 1. Synced tables (tables synced from other bases)
 * 2. Structural matches (tables with similar structure across bases)
 */
const { logger } = require('./logger');

/**
 * Detect all cross-base relationships from the stored schemas
 * @param {Array} bases - Array of base objects with schemaJson
 * @returns {Array} - Array of detected relationships
 */
function detectRelationships(bases, options = {}) {
  const structuralThreshold = options.structuralThreshold ?? 0.7;
  const confirmedThreshold = options.confirmedThreshold ?? 0.9;

  const relationships = [];
  logger.debug(
    'RelDetect',
    `Starting relationship detection for ${bases.length} bases (structural=${structuralThreshold}, confirmed=${confirmedThreshold})`,
  );

  const tableIndex = buildTableIndex(bases);
  logger.debug('RelDetect', `Built table index with ${tableIndex.byId.size} tables`);

  // 1. Detect synced tables (explicit sync metadata)
  const syncRelationships = detectSyncedTables(bases, tableIndex);
  logger.debug('RelDetect', `Found ${syncRelationships.length} sync relationships`);
  relationships.push(...syncRelationships);

  // 2. Detect cross-base linked records (links to tables in other bases)
  const crossBaseLinks = detectCrossBaseLinks(bases, tableIndex);
  logger.debug('RelDetect', `Found ${crossBaseLinks.length} cross-base link relationships`);
  relationships.push(...crossBaseLinks);

  // 3. Detect structural matches (tables that look like syncs)
  const structuralRelationships = detectStructuralMatches(bases, tableIndex, {
    structuralThreshold,
    confirmedThreshold,
  });
  logger.debug('RelDetect', `Found ${structuralRelationships.length} structural match relationships`);
  relationships.push(...structuralRelationships);

  // Deduplicate relationships
  const deduplicated = deduplicateRelationships(relationships);
  logger.debug('RelDetect', `After deduplication: ${deduplicated.length} relationships`);
  return deduplicated;
}

/**
 * Build an index of all tables across all bases for quick lookup
 */
function buildTableIndex(bases) {
  const index = {
    byId: new Map(), // tableId -> { base, table }
    byName: new Map(), // tableName (lowercase) -> [{ base, table }]
  };

  for (const base of bases) {
    if (!base.schemaJson) continue;

    try {
      const schema = JSON.parse(base.schemaJson);
      const tables = schema.tables || [];

      for (const table of tables) {
        // Index by ID
        index.byId.set(table.id, { base, table });

        // Index by name (lowercase for case-insensitive matching)
        const nameLower = table.name.toLowerCase();
        if (!index.byName.has(nameLower)) {
          index.byName.set(nameLower, []);
        }
        index.byName.get(nameLower).push({ base, table });
      }
    } catch (e) {
      logger.error('RelDetect', `Error parsing schema for base ${base.id}:`, e);
    }
  }

  return index;
}

/**
 * Detect tables that have explicit sync metadata
 * Airtable includes syncSource information for synced tables
 */
function detectSyncedTables(bases, tableIndex) {
  const relationships = [];

  for (const base of bases) {
    if (!base.schemaJson) {
      logger.debug('RelDetect', `Skipping base "${base.name}" - no schema`);
      continue;
    }

    try {
      const schema = JSON.parse(base.schemaJson);
      const tables = schema.tables || [];
      logger.debug('RelDetect', `Scanning ${tables.length} tables in base "${base.name}" for sync sources`);

      for (const table of tables) {
        // Check for sync source metadata
        // Airtable schema includes this for synced tables
        // Note: Airtable uses "application" to refer to bases in their API
        if (table.syncSource) {
          logger.debug(
            'RelDetect',
            `Found syncSource on table "${table.name}" in base "${base.name}":`,
            JSON.stringify(table.syncSource),
          );

          // Try multiple possible field names for the source base ID
          const sourceBaseId =
            table.syncSource.sourceApplicationId ||
            table.syncSource.sourceBaseId ||
            table.syncSource.applicationId ||
            table.syncSource.baseId;
          const sourceTableId = table.syncSource.sourceTableId || table.syncSource.tableId;

          if (sourceBaseId) {
            // Look up the source table
            const sourceInfo = tableIndex.byId.get(sourceTableId);
            logger.debug(
              'RelDetect',
              `Sync detected: ${sourceBaseId}/${sourceTableId} -> ${base.id}/${table.id}`,
            );

            relationships.push({
              sourceBaseId: sourceBaseId,
              targetBaseId: base.id,
              sourceTableName: sourceInfo?.table?.name || 'Unknown',
              targetTableName: table.name,
              confidence: 'confirmed',
              detectionReason: 'sync_metadata',
              type: 'sync',
            });
          } else {
            logger.warn(
              'RelDetect',
              'syncSource found but no sourceBaseId in:',
              JSON.stringify(table.syncSource),
            );
          }
        }
      }
    } catch (e) {
      logger.error('RelDetect', `Error detecting syncs for base ${base.id}:`, e);
    }
  }

  return relationships;
}

/**
 * Detect cross-base linked record fields
 * These are multipleRecordLinks fields that link to tables in other bases
 */
function detectCrossBaseLinks(bases, tableIndex) {
  const relationships = [];

  for (const base of bases) {
    if (!base.schemaJson) continue;

    try {
      const schema = JSON.parse(base.schemaJson);
      const tables = schema.tables || [];

      // Build a set of table IDs in this base
      const localTableIds = new Set(tables.map((t) => t.id));

      for (const table of tables) {
        const fields = table.fields || [];

        for (const field of fields) {
          // Check for linked record fields
          if (field.type === 'multipleRecordLinks') {
            const linkedTableId = field.options?.linkedTableId;

            if (linkedTableId && !localTableIds.has(linkedTableId)) {
              // This links to a table NOT in this base - it's a cross-base link!
              const targetInfo = tableIndex.byId.get(linkedTableId);

              if (targetInfo) {
                // Found the target base
                relationships.push({
                  sourceBaseId: base.id,
                  targetBaseId: targetInfo.base.id,
                  sourceTableName: table.name,
                  targetTableName: targetInfo.table.name,
                  fieldName: field.name,
                  confidence: 'confirmed',
                  detectionReason: 'cross_base_link',
                  type: 'link',
                });
              } else {
                // Target table not found in our indexed bases
                // This could be a link to a base we don't have access to
                logger.warn(
                  'RelDetect',
                  `Cross-base link found but target table ${linkedTableId} not in accessible bases`,
                );
              }
            }
          }
        }
      }
    } catch (e) {
      logger.error('RelDetect', `Error detecting cross-base links for base ${base.id}:`, e);
    }
  }

  return relationships;
}

/**
 * Detect tables that have similar structure across bases
 * (may indicate manual syncs or related tables)
 */
function detectStructuralMatches(bases, tableIndex, thresholds = {}) {
  const structuralThreshold = thresholds.structuralThreshold ?? 0.7;
  const confirmedThreshold = thresholds.confirmedThreshold ?? 0.9;
  const relationships = [];
  const processedPairs = new Set();

  // For each table name that appears in multiple bases
  for (const [tableName, tableInfos] of tableIndex.byName) {
    if (tableInfos.length < 2) continue;

    // Compare all pairs of tables with the same name
    for (let i = 0; i < tableInfos.length; i++) {
      for (let j = i + 1; j < tableInfos.length; j++) {
        const info1 = tableInfos[i];
        const info2 = tableInfos[j];

        // Skip if same base
        if (info1.base.id === info2.base.id) continue;

        // Create a unique key for this pair
        const pairKey = [info1.base.id, info2.base.id].sort().join('|');
        if (processedPairs.has(pairKey + tableName)) continue;
        processedPairs.add(pairKey + tableName);

        // Calculate structural similarity
        const similarity = calculateTableSimilarity(info1.table, info2.table);

        if (similarity.score >= structuralThreshold) {
          // High similarity - likely related
          relationships.push({
            sourceBaseId: info1.base.id,
            targetBaseId: info2.base.id,
            sourceTableName: info1.table.name,
            targetTableName: info2.table.name,
            confidence: similarity.score >= confirmedThreshold ? 'confirmed' : 'suspected',
            detectionReason: `structural_match:${Math.round(similarity.score * 100)}%`,
            type: 'structural',
            details: similarity.details,
          });
        }
      }
    }
  }

  return relationships;
}

/**
 * Calculate similarity score between two tables
 * Based on field names, types, and count
 */
function calculateTableSimilarity(table1, table2) {
  const fields1 = table1.fields || [];
  const fields2 = table2.fields || [];

  if (fields1.length === 0 || fields2.length === 0) {
    return { score: 0, details: 'No fields' };
  }

  // Create field name sets (lowercase)
  const names1 = new Set(fields1.map((f) => f.name.toLowerCase()));
  const names2 = new Set(fields2.map((f) => f.name.toLowerCase()));

  // Calculate intersection
  const intersection = new Set([...names1].filter((n) => names2.has(n)));
  const union = new Set([...names1, ...names2]);

  // Jaccard similarity for field names
  const nameSimilarity = intersection.size / union.size;

  // Check field types for matching names
  let typeMatches = 0;
  for (const fieldName of intersection) {
    const field1 = fields1.find((f) => f.name.toLowerCase() === fieldName);
    const field2 = fields2.find((f) => f.name.toLowerCase() === fieldName);
    if (field1 && field2 && field1.type === field2.type) {
      typeMatches++;
    }
  }

  const typeMatchRatio = intersection.size > 0 ? typeMatches / intersection.size : 0;

  // Combined score (weighted)
  const score = nameSimilarity * 0.6 + typeMatchRatio * 0.4;

  return {
    score,
    details: {
      sharedFields: intersection.size,
      totalFields: union.size,
      nameSimilarity: Math.round(nameSimilarity * 100),
      typeMatchRatio: Math.round(typeMatchRatio * 100),
    },
  };
}

/**
 * Remove duplicate relationships
 * Note: Only structural matches are bidirectional (A~B is the same as B~A)
 * Cross-base links and syncs are directional (A→B is different from B→A)
 */
function deduplicateRelationships(relationships) {
  const seen = new Map();

  for (const rel of relationships) {
    let key;

    if (rel.type === 'structural') {
      // Structural matches are bidirectional - sort for consistency
      const baseKey = [rel.sourceBaseId, rel.targetBaseId].sort().join('|');
      const tableKey = [rel.sourceTableName, rel.targetTableName].sort().join('|');
      key = `structural:${baseKey}:${tableKey}`;
    } else {
      // Links and syncs are directional - preserve source→target order
      // Include field name for links to allow multiple link fields between same tables
      const fieldPart = rel.fieldName ? `:${rel.fieldName}` : '';
      key = `${rel.type}:${rel.sourceBaseId}→${rel.targetBaseId}:${rel.sourceTableName}→${rel.targetTableName}${fieldPart}`;
    }

    // Keep the higher confidence one
    if (!seen.has(key) || getConfidenceLevel(rel.confidence) > getConfidenceLevel(seen.get(key).confidence)) {
      seen.set(key, rel);
    }
  }

  return Array.from(seen.values());
}

/**
 * Get numeric confidence level for comparison
 */
function getConfidenceLevel(confidence) {
  switch (confidence) {
    case 'confirmed':
      return 2;
    case 'suspected':
      return 1;
    default:
      return 0;
  }
}

/**
 * Get summary statistics about relationships
 */
function getRelationshipStats(relationships) {
  const stats = {
    total: relationships.length,
    confirmed: 0,
    suspected: 0,
    byType: {
      sync: 0,
      link: 0,
      structural: 0,
    },
    connectedBases: new Set(),
  };

  for (const rel of relationships) {
    if (rel.confidence === 'confirmed') stats.confirmed++;
    else stats.suspected++;

    if (rel.type === 'sync') stats.byType.sync++;
    else if (rel.type === 'link') stats.byType.link++;
    else if (rel.type === 'structural') stats.byType.structural++;

    stats.connectedBases.add(rel.sourceBaseId);
    stats.connectedBases.add(rel.targetBaseId);
  }

  stats.connectedBases = stats.connectedBases.size;

  return stats;
}

module.exports = {
  detectRelationships,
  buildTableIndex,
  detectSyncedTables,
  detectCrossBaseLinks,
  detectStructuralMatches,
  calculateTableSimilarity,
  getRelationshipStats,
};
