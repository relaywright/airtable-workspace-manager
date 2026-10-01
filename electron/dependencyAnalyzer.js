/**
 * Dependency and impact analysis for Airtable base relationships.
 *
 * Relationships are directed edges: source -> target.
 * "Downstream dependents" = bases that depend on this base (this base is their source).
 * "Upstream sources" = bases that this base depends on (this base is their target).
 */

/**
 * BFS traversal following relationship edges where baseId is the source.
 * Returns array of dependent base IDs with depth.
 * @param {string} baseId - The base to start from
 * @param {Array} relationships - All relationships
 * @returns {Array<{baseId: string, depth: number}>}
 */
function getDownstreamDependents(baseId, relationships) {
  const result = [];
  const visited = new Set([baseId]);
  const queue = [{ id: baseId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();

    // Find all relationships where the current base is the source
    const outgoing = relationships.filter((r) => r.sourceBaseId === current.id);

    for (const rel of outgoing) {
      if (!visited.has(rel.targetBaseId)) {
        visited.add(rel.targetBaseId);
        const nextDepth = current.depth + 1;
        result.push({ baseId: rel.targetBaseId, depth: nextDepth });
        queue.push({ id: rel.targetBaseId, depth: nextDepth });
      }
    }
  }

  return result;
}

/**
 * BFS traversal following edges where baseId is the target.
 * Returns array of source base IDs with depth.
 * @param {string} baseId - The base to start from
 * @param {Array} relationships - All relationships
 * @returns {Array<{baseId: string, depth: number}>}
 */
function getUpstreamSources(baseId, relationships) {
  const result = [];
  const visited = new Set([baseId]);
  const queue = [{ id: baseId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();

    // Find all relationships where the current base is the target
    const incoming = relationships.filter((r) => r.targetBaseId === current.id);

    for (const rel of incoming) {
      if (!visited.has(rel.sourceBaseId)) {
        visited.add(rel.sourceBaseId);
        const nextDepth = current.depth + 1;
        result.push({ baseId: rel.sourceBaseId, depth: nextDepth });
        queue.push({ id: rel.sourceBaseId, depth: nextDepth });
      }
    }
  }

  return result;
}

/**
 * Calculate how critical a base is based on its dependency graph.
 * Score = direct dependents + (transitive dependents * 0.5)
 * @param {string} baseId
 * @param {Array} relationships
 * @returns {number}
 */
function calculateCriticalityScore(baseId, relationships) {
  const downstream = getDownstreamDependents(baseId, relationships);

  const directCount = downstream.filter((d) => d.depth === 1).length;
  const transitiveCount = downstream.filter((d) => d.depth > 1).length;

  return directCount + transitiveCount * 0.5;
}

/**
 * Full impact report for a base.
 * @param {string} baseId
 * @param {Array} relationships
 * @param {Array} bases - All bases (for name lookups)
 * @returns {Object} Impact report
 */
function getImpactReport(baseId, relationships, bases) {
  const upstream = getUpstreamSources(baseId, relationships);
  const downstream = getDownstreamDependents(baseId, relationships);
  const criticalityScore = calculateCriticalityScore(baseId, relationships);

  // Count direct outgoing relationships
  const directOutgoing = relationships.filter((r) => r.sourceBaseId === baseId).length;

  const isHub = directOutgoing > 3;
  const isLeaf = directOutgoing === 0;

  // Enrich with base names
  const getBaseName = (id) => {
    const base = bases.find((b) => b.id === id);
    return base ? base.name : id;
  };

  const enriched = (items) =>
    items.map((item) => ({
      ...item,
      name: getBaseName(item.baseId),
    }));

  return {
    baseId,
    upstream: enriched(upstream),
    downstream: enriched(downstream),
    criticalityScore,
    isHub,
    isLeaf,
    totalAffected: upstream.length + downstream.length,
  };
}

/**
 * DFS-based cycle detection across all relationships.
 * Returns array of cycles found.
 * @param {Array} relationships
 * @returns {Array<{path: string[]}>}
 */
function detectCircularDependencies(relationships) {
  // Build adjacency list
  const adjacency = new Map();
  for (const rel of relationships) {
    if (!adjacency.has(rel.sourceBaseId)) {
      adjacency.set(rel.sourceBaseId, []);
    }
    adjacency.get(rel.sourceBaseId).push(rel.targetBaseId);
  }

  const cycles = [];
  const globalVisited = new Set();

  for (const startNode of adjacency.keys()) {
    if (globalVisited.has(startNode)) continue;

    // DFS with path tracking
    const pathSet = new Set();
    const pathList = [];
    const stack = [{ node: startNode, index: 0 }];
    pathSet.add(startNode);
    pathList.push(startNode);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adjacency.get(frame.node) || [];

      if (frame.index < neighbors.length) {
        const next = neighbors[frame.index];
        frame.index++;

        if (pathSet.has(next)) {
          // Found a cycle - extract the cycle path
          const cycleStart = pathList.indexOf(next);
          const cyclePath = pathList.slice(cycleStart).concat(next);
          // Normalize: start from the smallest ID to avoid duplicate cycles
          const minIdx = cyclePath
            .slice(0, -1)
            .reduce((minI, _, i, arr) => (arr[i] < arr[minI] ? i : minI), 0);
          const normalized = [
            ...cyclePath.slice(minIdx, -1),
            ...cyclePath.slice(0, minIdx),
            cyclePath[minIdx],
          ];
          // Check if this normalized cycle is already recorded
          const key = normalized.join('->');
          const isDuplicate = cycles.some((c) => c.path.join('->') === key);
          if (!isDuplicate) {
            cycles.push({ path: normalized });
          }
        } else if (!globalVisited.has(next)) {
          pathSet.add(next);
          pathList.push(next);
          stack.push({ node: next, index: 0 });
        }
      } else {
        // Backtrack
        stack.pop();
        pathSet.delete(frame.node);
        pathList.pop();
        globalVisited.add(frame.node);
      }
    }
  }

  return cycles;
}

/**
 * Classify each base by its role in the sync graph.
 * "source" = only outgoing edges (source of truth)
 * "leaf" = only incoming edges (data consumer)
 * "relay" = both incoming and outgoing (passes data through)
 * "isolated" = no edges at all
 * @param {Array} relationships
 * @returns {Map<string, string>} baseId → role
 */
function classifyBases(relationships) {
  const hasOutgoing = new Set();
  const hasIncoming = new Set();
  const allBases = new Set();

  for (const rel of relationships) {
    hasOutgoing.add(rel.sourceBaseId);
    hasIncoming.add(rel.targetBaseId);
    allBases.add(rel.sourceBaseId);
    allBases.add(rel.targetBaseId);
  }

  const classification = {};
  for (const baseId of allBases) {
    const out = hasOutgoing.has(baseId);
    const inc = hasIncoming.has(baseId);

    if (out && !inc) classification[baseId] = 'source';
    else if (!out && inc) classification[baseId] = 'leaf';
    else if (out && inc) classification[baseId] = 'relay';
    else classification[baseId] = 'isolated';
  }

  return classification;
}

/**
 * Find all directed paths from source bases to leaf bases using DFS.
 * A source is a base with only outgoing edges; a leaf has only incoming edges.
 * @param {Array} relationships
 * @returns {Array<{path: string[], length: number}>}
 */
function traceSyncChains(relationships) {
  const classification = classifyBases(relationships);

  // Build adjacency list
  const adjacency = new Map();
  for (const rel of relationships) {
    if (!adjacency.has(rel.sourceBaseId)) {
      adjacency.set(rel.sourceBaseId, []);
    }
    adjacency.get(rel.sourceBaseId).push(rel.targetBaseId);
  }

  const sources = Object.entries(classification)
    .filter(([, role]) => role === 'source')
    .map(([id]) => id);

  const chains = [];

  // DFS from each source, collect paths that end at a leaf
  for (const source of sources) {
    const stack = [{ node: source, path: [source] }];

    while (stack.length > 0) {
      const { node, path } = stack.pop();
      const neighbors = adjacency.get(node) || [];

      if (neighbors.length === 0 || classification[node] === 'leaf') {
        // Reached a leaf or dead end — record the chain if length > 1
        if (path.length > 1) {
          chains.push({ path: [...path], length: path.length });
        }
        continue;
      }

      for (const next of neighbors) {
        if (!path.includes(next)) {
          stack.push({ node: next, path: [...path, next] });
        }
      }
    }
  }

  // Sort by length descending
  chains.sort((a, b) => b.length - a.length);
  return chains;
}

/**
 * Get the longest sync chain.
 * @param {Array} relationships
 * @returns {{path: string[], length: number}|null}
 */
function getLongestChain(relationships) {
  const chains = traceSyncChains(relationships);
  return chains.length > 0 ? chains[0] : null;
}

module.exports = {
  getDownstreamDependents,
  getUpstreamSources,
  calculateCriticalityScore,
  getImpactReport,
  detectCircularDependencies,
  traceSyncChains,
  classifyBases,
  getLongestChain,
};
