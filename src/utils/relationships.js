/**
 * Count cross-base connections per base.
 *
 * A connection is one detected relationship record (sync, link, or structural match)
 * that has the base at either end. Two bases with a relationship in each direction
 * therefore have two connections, matching the base detail panel's connection list
 * and the main-process health stats.
 *
 * @param {Array<{ sourceBaseId: string, targetBaseId: string }>} relationships
 * @returns {Record<string, number>} base ID to connection count (bases without connections are absent)
 */
export function getConnectionCounts(relationships) {
  const counts = {};
  for (const rel of relationships || []) {
    counts[rel.sourceBaseId] = (counts[rel.sourceBaseId] || 0) + 1;
    counts[rel.targetBaseId] = (counts[rel.targetBaseId] || 0) + 1;
  }
  return counts;
}
