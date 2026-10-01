import React, {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useState,
} from 'react';
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { useAppContext } from '../context/AppContext';
import { generateThumbnailDataUrl, getColorForBase } from '../utils/thumbnailGenerator';
import { fitGraph } from '../utils/graphViewport';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { logger } from '../utils/logger';

// Register the cose-bilkent layout extension (guard against duplicate registration during HMR)
if (!cytoscape.prototype._coseBilkentRegistered) {
  cytoscape.use(coseBilkent);
  cytoscape.prototype._coseBilkentRegistered = true;
}

// Thumbnail cache — SVG data URLs are deterministic per (baseId, name, size) so only generate once
const thumbnailCache = new Map();
function getCachedThumbnail(baseId, baseName, size) {
  const key = `${baseId}:${size}`;
  let cached = thumbnailCache.get(key);
  if (!cached) {
    cached = generateThumbnailDataUrl(baseId, baseName, size);
    thumbnailCache.set(key, cached);
  }
  return cached;
}

const LAYOUT_OPTIONS = [
  { value: 'cose', label: 'Force Directed' },
  { value: 'cose-bilkent', label: 'Bilkent' },
  { value: 'breadthfirst', label: 'Hierarchical' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'circle', label: 'Circle' },
];

const FIT_PADDING = 50;
const OVERLAY_GAP = 12;

// The legend, layout picker and zoom controls float over the map. Measure them and offer
// fitGraph two ways to keep nodes and labels out from under them: reserve the side columns the
// panels sit in, or reserve bands across the top and bottom. fitGraph keeps whichever leaves the
// graph larger (side columns on a wide map, bands once the detail panel narrows it).
export function getOverlayFitPaddings(container, panels) {
  if (!container) return [FIT_PADDING];
  const bounds = container.getBoundingClientRect();
  const rects = panels
    .filter(Boolean)
    .map((panel) => panel.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0 || bounds.width === 0) return [FIT_PADDING];

  const reserved = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const rect of rects) {
    if (rect.left + rect.width / 2 < bounds.left + bounds.width / 2) {
      reserved.left = Math.max(reserved.left, rect.right - bounds.left);
    } else {
      reserved.right = Math.max(reserved.right, bounds.right - rect.left);
    }
    if (rect.top + rect.height / 2 < bounds.top + bounds.height / 2) {
      reserved.top = Math.max(reserved.top, rect.bottom - bounds.top);
    } else {
      reserved.bottom = Math.max(reserved.bottom, bounds.bottom - rect.top);
    }
  }
  const clear = (size) => Math.max(FIT_PADDING, size + OVERLAY_GAP);
  return [
    { top: FIT_PADDING, bottom: FIT_PADDING, left: clear(reserved.left), right: clear(reserved.right) },
    { left: FIT_PADDING, right: FIT_PADDING, top: clear(reserved.top), bottom: clear(reserved.bottom) },
  ];
}

// Keep in sync with the nodeMatch / nodeOther colors in tailwind.config.js (used by the legend)
const NODE_MATCH_COLOR = '#6366f1';
const NODE_OTHER_COLOR = '#64748b';

// Trace mode role colors, shared by the map stylesheet and the legend so they can't drift
export const TRACE_COLORS = {
  source: '#22c55e',
  leaf: '#94a3b8',
  relay: '#3b82f6',
  isolated: '#334155',
  circular: '#f97316',
  path: '#a78bfa',
};

// Node labels wrap onto a second line instead of running into neighboring labels
const LABEL_MAX_WIDTH = 110;
// Cytoscape rejects single-quoted family names and silently falls back to its default font.
const LABEL_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

// Every layout reserves room for node labels (nodeDimensionsIncludeLabels) and leaves
// fitting to fitGraph so small graphs are not zoomed up to fill the screen.
export function getLayoutConfig(name, nodeCount) {
  const numIter = nodeCount > 200 ? 200 : nodeCount > 100 ? 400 : 1000;
  const shared = { fit: false, nodeDimensionsIncludeLabels: true, animationDuration: 500 };
  const configs = {
    cose: {
      name: 'cose',
      animate: true,
      randomize: true,
      nodeRepulsion: 4500,
      nodeOverlap: 20,
      idealEdgeLength: nodeCount > 100 ? 150 : 90,
      edgeElasticity: 100,
      nestingFactor: 5,
      gravity: 1,
      componentSpacing: 60,
      numIter,
      coolingFactor: 0.99,
      minTemp: 1.0,
    },
    'cose-bilkent': {
      name: 'cose-bilkent',
      animate: 'end',
      randomize: true,
      nodeRepulsion: 6000,
      idealEdgeLength: nodeCount > 100 ? 150 : 120,
      edgeElasticity: 0.45,
      nestingFactor: 0.1,
      gravity: 0.25,
      numIter: nodeCount > 300 ? 500 : nodeCount > 150 ? 1000 : 2500,
      tile: true,
    },
    breadthfirst: {
      name: 'breadthfirst',
      animate: true,
      directed: true,
      spacingFactor: 1.2,
      avoidOverlap: true,
    },
    concentric: {
      name: 'concentric',
      animate: true,
      avoidOverlap: true,
      minNodeSpacing: 40,
      concentric: (node) => node.degree(),
      levelWidth: () => 2,
    },
    circle: {
      name: 'circle',
      animate: true,
      avoidOverlap: true,
      spacingFactor: 1,
    },
  };
  return { ...shared, ...(configs[name] || configs.cose) };
}

export function getMapStylesheet(isLargeGraph) {
  return [
    {
      selector: 'node',
      style: {
        'background-image': 'data(bgImage)',
        'background-fit': 'cover',
        'background-clip': 'node',
        label: 'data(label)',
        color: '#e2e8f0',
        'font-family': LABEL_FONT_FAMILY,
        'font-size': 12,
        'font-weight': 500,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 6,
        'text-wrap': 'wrap',
        'text-max-width': LABEL_MAX_WIDTH,
        'line-height': 1.25,
        'text-background-color': '#0f0f1a',
        'text-background-opacity': 0.85,
        'text-background-padding': 2,
        'text-background-shape': 'roundrectangle',
        'min-zoomed-font-size': isLargeGraph ? 7 : 0, // Skip unreadably small labels on big graphs
        width: 'data(size)',
        height: 'data(size)',
        'border-width': 2,
        'border-color': '#2d2d4a',
        'border-opacity': 0.5,
        shape: 'roundrectangle',
        'corner-radius': 8,
      },
    },
    // Naming convention outline (only set while a convention is enabled in Settings)
    {
      selector: 'node[convention = "match"]',
      style: {
        'border-width': 3,
        'border-color': NODE_MATCH_COLOR,
        'border-opacity': 1,
      },
    },
    {
      selector: 'node[convention = "other"]',
      style: {
        'border-width': 3,
        'border-color': NODE_OTHER_COLOR,
        'border-opacity': 1,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': '#6366f1',
        'border-opacity': 1,
      },
    },
    // Spotlight pulse — applied temporarily when navigating to a node from sidebar/search
    {
      selector: 'node.spotlight',
      style: {
        'border-width': 4,
        'border-color': '#818cf8',
        'border-opacity': 1,
        'z-index': 20,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'curve-style': isLargeGraph ? 'straight' : 'bezier', // Straight is much cheaper to render than bezier
        opacity: 0.7,
      },
    },
    // Trace mode: role-based styles
    {
      selector: 'node.trace-source',
      style: {
        'border-width': 3,
        'border-color': TRACE_COLORS.source,
        'border-opacity': 1,
      },
    },
    {
      selector: 'node.trace-leaf',
      style: {
        'border-width': 3,
        'border-color': TRACE_COLORS.leaf,
        'border-opacity': 1,
      },
    },
    {
      selector: 'node.trace-relay',
      style: {
        'border-width': 3,
        'border-color': TRACE_COLORS.relay,
        'border-opacity': 1,
      },
    },
    {
      selector: 'node.trace-isolated',
      style: {
        'border-width': 2,
        'border-color': TRACE_COLORS.isolated,
        'border-opacity': 0.5,
        opacity: 0.5,
      },
    },
    {
      selector: 'node.trace-circular',
      style: {
        'border-width': 4,
        'border-color': TRACE_COLORS.circular,
        'border-opacity': 1,
      },
    },
    // Trace mode: highlighted path
    {
      selector: 'node.trace-highlighted',
      style: {
        'border-width': 4,
        'border-color': TRACE_COLORS.path,
        'border-opacity': 1,
        'z-index': 10,
      },
    },
    {
      selector: 'edge.trace-highlighted',
      style: {
        width: 4,
        'line-color': TRACE_COLORS.path,
        'target-arrow-color': TRACE_COLORS.path,
        opacity: 1,
        'z-index': 10,
      },
    },
    // Trace mode: dimmed (non-highlighted)
    {
      selector: 'node.trace-dimmed',
      style: {
        opacity: 0.2,
      },
    },
    {
      selector: 'edge.trace-dimmed',
      style: {
        opacity: 0.1,
      },
    },
  ];
}

export const WorkspaceMap = forwardRef(function WorkspaceMap({ onViewSchema }, ref) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const legendRef = useRef(null);
  const layoutPanelRef = useRef(null);
  const zoomControlsRef = useRef(null);
  const [selectedLayout, setSelectedLayout] = useState('cose');
  const [traceMode, setTraceMode] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);
  const traceModeRef = useRef(false);
  const [baseClassification, setBaseClassification] = useState({});
  const [circularNodes, setCircularNodes] = useState(new Set());
  const { bases, relationships, selectedBase, selectBase, showArchived, namingConvention } = useAppContext();
  const conventionEnabled = Boolean(namingConvention?.enabled);

  // Cytoscape event handlers are bound once per instance; read the latest props through a ref
  const latestRef = useRef({ bases, selectBase, onViewSchema });
  useEffect(() => {
    latestRef.current = { bases, selectBase, onViewSchema };
  }, [bases, selectBase, onViewSchema]);

  // Fit the whole graph into the part of the map not covered by the floating panels
  const fitToView = useCallback((options = {}) => {
    const paddingOptions = getOverlayFitPaddings(containerRef.current, [
      legendRef.current,
      layoutPanelRef.current,
      zoomControlsRef.current,
    ]);
    fitGraph(cyRef.current, { ...options, paddingOptions });
  }, []);

  // Filter out archived bases unless showArchived is true
  const visibleBases = useMemo(() => {
    if (showArchived) return bases;
    return bases.filter((b) => !b.isArchived);
  }, [bases, showArchived]);

  // Track whether we're in "large graph" mode (150+ nodes) — used to toggle perf options
  const isLargeGraph = visibleBases.length > 150;

  // Filter relationships to only include visible bases
  const visibleRelationships = useMemo(() => {
    const visibleIds = new Set(visibleBases.map((b) => b.id));
    return relationships.filter((r) => visibleIds.has(r.sourceBaseId) && visibleIds.has(r.targetBaseId));
  }, [relationships, visibleBases]);

  // Load base classifications and circular deps when trace mode is toggled on
  useEffect(() => {
    if (!traceMode) return;
    let cancelled = false;
    (async () => {
      try {
        const [classResult, circResult] = await Promise.all([
          window.api.classifyBases(),
          window.api.detectCircularDeps(),
        ]);
        if (cancelled) return;
        if (classResult.success) setBaseClassification(classResult.data);
        if (circResult.success && circResult.data) {
          const nodeSet = new Set();
          for (const cycle of circResult.data) {
            for (const id of cycle.path) nodeSet.add(id);
          }
          setCircularNodes(nodeSet);
        }
      } catch (err) {
        logger.error('WorkspaceMap', 'Error loading trace data:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceMode, relationships]);

  // Keep ref in sync with state so Cytoscape event handlers see the latest value
  useEffect(() => {
    traceModeRef.current = traceMode;
  }, [traceMode]);

  // Apply role-based styling when trace mode or classification changes, or the graph is rebuilt
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Batch all class changes to avoid per-element style recalculation
    cy.batch(() => {
      cy.nodes().removeClass(
        'trace-source trace-leaf trace-relay trace-isolated trace-circular trace-highlighted trace-dimmed',
      );
      cy.edges().removeClass('trace-highlighted trace-dimmed');

      if (!traceMode) return;

      // Apply role classes based on classification
      cy.nodes().forEach((node) => {
        const role = baseClassification[node.id()];
        if (role) node.addClass(`trace-${role}`);
        if (circularNodes.has(node.id())) node.addClass('trace-circular');
      });
    });
  }, [traceMode, baseClassification, circularNodes, graphVersion]);

  // Initialize Cytoscape — recreates when large-graph threshold is crossed
  useEffect(() => {
    if (!containerRef.current) return;

    cyRef.current = cytoscape({
      container: containerRef.current,
      // --- Performance options for large graphs ---
      textureOnViewport: isLargeGraph, // Render to bitmap during pan/zoom instead of redrawing all elements
      hideEdgesOnViewport: isLargeGraph, // Hide edges during interaction (they're the most expensive to draw)
      hideLabelsOnViewport: isLargeGraph, // Hide labels during interaction (unreadable when zoomed out anyway)
      pixelRatio: isLargeGraph ? 1 : 'auto', // Use 1x resolution on large graphs (2x doubles the pixel count)
      style: getMapStylesheet(isLargeGraph),
      layout: { name: 'preset' }, // Start empty — layout runs when data is added
      minZoom: 0.1,
      maxZoom: 2.5,
      wheelSensitivity: 0.5,
    });

    // Node click handler (trace-aware)
    cyRef.current.on('tap', 'node', (event) => {
      const nodeId = event.target.id();
      const { bases: currentBases, selectBase: select } = latestRef.current;
      const base = currentBases.find((b) => b.id === nodeId);

      if (traceModeRef.current && cyRef.current) {
        const cy = cyRef.current;
        // Clear previous highlights (batched to avoid per-element style recalc)
        cy.batch(() => {
          cy.nodes().removeClass('trace-highlighted trace-dimmed');
          cy.edges().removeClass('trace-highlighted trace-dimmed');
        });

        // BFS forward (downstream) and backward (upstream) from clicked node
        // Uses Cytoscape's native traversal API instead of scanning all edges per step
        const clickedNode = cy.getElementById(nodeId);
        const connectedNodeIds = new Set([nodeId]);
        const connectedEdgeIds = new Set();

        // Forward BFS (follow outgoing edges)
        const forwardQueue = [clickedNode];
        while (forwardQueue.length > 0) {
          const current = forwardQueue.shift();
          current.outgoers('edge').forEach((e) => {
            connectedEdgeIds.add(e.id());
            const target = e.target();
            if (!connectedNodeIds.has(target.id())) {
              connectedNodeIds.add(target.id());
              forwardQueue.push(target);
            }
          });
        }

        // Backward BFS (follow incoming edges)
        const backwardQueue = [clickedNode];
        while (backwardQueue.length > 0) {
          const current = backwardQueue.shift();
          current.incomers('edge').forEach((e) => {
            connectedEdgeIds.add(e.id());
            const source = e.source();
            if (!connectedNodeIds.has(source.id())) {
              connectedNodeIds.add(source.id());
              backwardQueue.push(source);
            }
          });
        }

        // Highlight connected, dim the rest — batch class changes
        cy.batch(() => {
          cy.nodes().forEach((n) => {
            if (connectedNodeIds.has(n.id())) n.addClass('trace-highlighted');
            else n.addClass('trace-dimmed');
          });
          cy.edges().forEach((e) => {
            if (connectedEdgeIds.has(e.id())) e.addClass('trace-highlighted');
            else e.addClass('trace-dimmed');
          });
        });
      }

      // Only select if the base still exists in our data (prevents crash on deleted bases)
      if (base) {
        select(base);
      }
    });

    // Node double-click to view schema
    cyRef.current.on('dbltap', 'node', (event) => {
      const nodeId = event.target.id();
      const { bases: currentBases, onViewSchema: viewSchema } = latestRef.current;
      const base = currentBases.find((b) => b.id === nodeId);
      if (base && viewSchema) {
        viewSchema(base);
      }
    });

    // Background click to deselect and clear trace highlights
    cyRef.current.on('tap', (event) => {
      if (event.target === cyRef.current) {
        latestRef.current.selectBase(null);
        if (traceModeRef.current) {
          cyRef.current.batch(() => {
            cyRef.current.nodes().removeClass('trace-highlighted trace-dimmed');
            cyRef.current.edges().removeClass('trace-highlighted trace-dimmed');
          });
        }
      }
    });

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [isLargeGraph]);

  // Update graph data — deferred to avoid blocking the main thread on large graphs
  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cyRef.current;

    // Clear existing elements
    cy.elements().remove();

    if (visibleBases.length === 0) return;

    // Defer heavy work to let the browser paint first
    const rafId = requestAnimationFrame(() => {
      try {
        // Add nodes
        const nodes = visibleBases.map((base) => {
          const tableCount = base.tableCount || 0;
          const size = Math.max(36, Math.min(64, 36 + tableCount * 2));
          const colors = getColorForBase(base.id);
          const thumbnail = getCachedThumbnail(base.id, base.name, size);

          return {
            data: {
              id: base.id,
              label: base.name,
              color: colors.primary,
              bgImage: thumbnail,
              size,
              tableCount,
              isArchived: base.isArchived || 0,
              convention: conventionEnabled ? (base.matchesConvention ? 'match' : 'other') : 'none',
            },
          };
        });

        // Add edges
        const edges = visibleRelationships.map((rel, index) => ({
          data: {
            id: `edge-${index}`,
            source: rel.sourceBaseId,
            target: rel.targetBaseId,
            color: rel.confidence === 'confirmed' ? '#10b981' : '#f59e0b',
            label: `${rel.sourceTableName || ''} → ${rel.targetTableName || ''}`,
          },
        }));

        cy.add([...nodes, ...edges]);

        // Run layout using selected layout config
        const nodeCount = visibleBases.length;
        const layoutConfig = getLayoutConfig(selectedLayout, nodeCount);
        // For initial data load, don't animate: jump straight to final positions
        logger.debug('WorkspaceMap', `Running ${selectedLayout} layout: ${nodeCount} nodes`);
        cy.layout({ ...layoutConfig, animate: false }).run();

        fitToView();
        setGraphVersion((v) => v + 1);
        logger.debug('WorkspaceMap', 'Layout complete');
      } catch (err) {
        logger.error('WorkspaceMap', 'Error updating graph:', err);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [visibleBases, visibleRelationships, selectedLayout, conventionEnabled, fitToView]);

  // Update selection: frame the selected base with its connections, then pulse it
  const spotlightTimerRef = useRef(null);
  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    cy.nodes().unselect();
    // Clear any previous spotlight
    cy.nodes().removeClass('spotlight');
    if (spotlightTimerRef.current) {
      clearTimeout(spotlightTimerRef.current);
      spotlightTimerRef.current = null;
    }

    if (selectedBase) {
      const node = cy.getElementById(selectedBase.id);
      if (node && node.length > 0) {
        node.select();
        // Selecting a base usually opens the detail panel; measure the map's current size first
        cy.resize();

        // Frame the base with its directly connected bases, clear of the floating panels.
        // An unconnected base is centered at the fit zoom cap instead of blown up.
        fitToView({
          eles: node.closedNeighborhood(),
          animate: true,
          duration: 400,
          complete: () => {
            // Add spotlight glow after the camera arrives, then fade it out after a moment
            node.addClass('spotlight');
            spotlightTimerRef.current = setTimeout(() => {
              if (cyRef.current) {
                node.removeClass('spotlight');
              }
            }, 1500);
          },
        });
      }
    }
    // Cleanup timer if component unmounts or selectedBase changes before timeout fires
    return () => {
      if (spotlightTimerRef.current) {
        clearTimeout(spotlightTimerRef.current);
        spotlightTimerRef.current = null;
      }
    };
  }, [selectedBase, fitToView]);

  const handleZoomIn = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.zoom(cyRef.current.zoom() * 1.2);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.zoom(cyRef.current.zoom() * 0.8);
    }
  }, []);

  const handleFit = useCallback(() => {
    fitToView({ animate: true });
  }, [fitToView]);

  const handleLayoutChange = useCallback(
    (layoutName) => {
      setSelectedLayout(layoutName);
      const cy = cyRef.current;
      if (cy && cy.nodes().length > 0) {
        const layout = cy.layout(getLayoutConfig(layoutName, cy.nodes().length));
        // Fit once the layout (and its animation) has finished
        layout.one('layoutstop', () => fitToView({ animate: true }));
        layout.run();
      }
    },
    [fitToView],
  );

  // The detail panel opening or closing resizes the map. Cytoscape does not notice container
  // resizes on its own, so re-measure and bring the graph (or the selected base and its
  // connections) back into view.
  const handleContainerResize = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.resize();
    if (cy.nodes().length === 0) return;

    const selected = cy.nodes(':selected');
    if (selected.length > 0) {
      // Queued so an in-flight selection animation (and its spotlight pulse) still finishes
      fitToView({ eles: selected.closedNeighborhood(), animate: true, queue: true });
    } else {
      fitToView({ animate: true });
    }
  }, [fitToView]);
  useResizeObserver(containerRef, handleContainerResize);

  // Export map as PNG
  const exportAsPng = useCallback(() => {
    if (cyRef.current) {
      return cyRef.current.png({
        output: 'base64',
        bg: '#0f0f1a',
        full: true,
        scale: 2,
      });
    }
    return null;
  }, []);

  // Expose export function via ref
  useImperativeHandle(
    ref,
    () => ({
      exportAsPng,
    }),
    [exportAsPng],
  );

  return (
    <div className="relative w-full h-full bg-background">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Zoom controls */}
      <div ref={zoomControlsRef} className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-textSecondary hover:bg-surfaceLight transition-colors"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-textSecondary hover:bg-surfaceLight transition-colors"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={handleFit}
          className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center text-textSecondary hover:bg-surfaceLight transition-colors"
          title="Fit to view"
          aria-label="Fit to view"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>
      </div>

      {/* Layout selector + Trace Mode toggle */}
      <div
        ref={layoutPanelRef}
        className="absolute top-4 right-4 bg-surface border border-border rounded-lg p-3"
      >
        <div className="text-xs font-medium text-textPrimary mb-2">Layout</div>
        <div className="flex flex-col gap-1">
          {LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleLayoutChange(opt.value)}
              className={`text-xs px-2 py-1.5 rounded text-left transition-colors ${
                selectedLayout === opt.value
                  ? 'bg-accent text-white'
                  : 'text-textSecondary hover:bg-surfaceLight hover:text-textPrimary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <button
            onClick={() => setTraceMode((prev) => !prev)}
            className={`w-full text-xs px-2 py-1.5 rounded flex items-center gap-2 transition-colors ${
              traceMode
                ? 'bg-purple-600 text-white'
                : 'text-textSecondary hover:bg-surfaceLight hover:text-textPrimary'
            }`}
            title="Toggle Trace Mode: click a node to highlight all data flow paths"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Trace Mode
          </button>
        </div>
      </div>

      {/* Legend */}
      <div ref={legendRef} className="absolute top-4 left-4 bg-surface border border-border rounded-lg p-3">
        <div className="text-xs font-medium text-textPrimary mb-2">Legend</div>
        <div className="space-y-1.5">
          {traceMode ? (
            <>
              <div className="flex items-center gap-2">
                <div
                  data-testid="legend-swatch-source"
                  className="w-3 h-3 rounded border-2"
                  style={{ borderColor: TRACE_COLORS.source }}
                />
                <span className="text-xs text-textSecondary">Source (origin)</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  data-testid="legend-swatch-leaf"
                  className="w-3 h-3 rounded border-2"
                  style={{ borderColor: TRACE_COLORS.leaf }}
                />
                <span className="text-xs text-textSecondary">Leaf (endpoint)</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  data-testid="legend-swatch-relay"
                  className="w-3 h-3 rounded border-2"
                  style={{ borderColor: TRACE_COLORS.relay }}
                />
                <span className="text-xs text-textSecondary">Relay (pass-through)</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  data-testid="legend-swatch-isolated"
                  className="w-3 h-3 rounded border-2 opacity-50"
                  style={{ borderColor: TRACE_COLORS.isolated }}
                />
                <span className="text-xs text-textSecondary">Isolated (no links)</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  data-testid="legend-swatch-path"
                  className="w-4 h-0.5"
                  style={{ backgroundColor: TRACE_COLORS.path }}
                />
                <span className="text-xs text-textSecondary">Traced path</span>
              </div>
              {circularNodes.size > 0 && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
                  <div
                    data-testid="legend-swatch-circular"
                    className="w-3 h-3 rounded border-2"
                    style={{ borderColor: TRACE_COLORS.circular }}
                  />
                  <span className="text-xs text-textSecondary">Circular dependency</span>
                </div>
              )}
              <div className="mt-2 pt-2 border-t border-border">
                <p className="text-[10px] text-textMuted">Click a node to trace its data flow paths</p>
              </div>
            </>
          ) : (
            <>
              {conventionEnabled && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded border-2 border-nodeMatch" />
                    <span className="text-xs text-textSecondary">{namingConvention.label}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                    <div className="w-3 h-3 rounded border-2 border-nodeOther" />
                    <span className="text-xs text-textSecondary">Other</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-edgeConfirmed" />
                <span className="text-xs text-textSecondary">Confirmed sync</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-edgeSuspected" />
                <span className="text-xs text-textSecondary">Suspected sync</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default WorkspaceMap;
