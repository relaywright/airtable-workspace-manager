import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import cytoscape from 'cytoscape';
import { useAppContext } from '../context/AppContext';
import { pluralize } from '../utils/format';
import { getConnectionCounts } from '../utils/relationships';
import { fitGraph } from '../utils/graphViewport';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { logger } from '../utils/logger';

const FIT_PADDING = 50;

// Table circles grow with their number of links, within a readable range
const nodeSize = (ele) => Math.min(96, 56 + (ele.data('linkCount') || 0) * 6);

export function BaseSchemaMap({ base, onBack }) {
  const { relationships: baseRelationships, namingConvention } = useAppContext();
  const containerRef = useRef(null);
  const graphAreaRef = useRef(null);
  const cyRef = useRef(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [focusMode, setFocusMode] = useState(true); // Dim non-connected nodes when selecting
  const [hideLeafNodes, setHideLeafNodes] = useState(false);
  const [layoutType, setLayoutType] = useState('cose'); // 'cose', 'concentric', 'breadthfirst'
  const [fullBase, setFullBase] = useState(base);
  const [loadingSchema, setLoadingSchema] = useState(false);

  // Load full base data (with schema) on demand if not already present
  useEffect(() => {
    if (base && !base.schemaJson) {
      setLoadingSchema(true);
      window.api
        .getBase(base.id)
        .then((result) => {
          if (result.success && result.data) {
            setFullBase(result.data);
          }
          setLoadingSchema(false);
        })
        .catch(() => setLoadingSchema(false));
    } else {
      setFullBase(base);
    }
  }, [base]);

  // Parse schema to get tables and relationships
  const { tables, relationships } = useMemo(() => {
    if (!fullBase?.schemaJson) {
      return { tables: [], relationships: [] };
    }

    try {
      const schema = JSON.parse(fullBase.schemaJson);
      const tables = schema.tables || [];
      const relationships = [];

      // Find linked record fields to create relationships
      for (const table of tables) {
        for (const field of table.fields || []) {
          // Check if field is a linked record type
          if (field.type === 'multipleRecordLinks') {
            const linkedTableId = field.options?.linkedTableId;
            if (linkedTableId) {
              relationships.push({
                id: `${table.id}-${field.id}`,
                sourceTableId: table.id,
                sourceTableName: table.name,
                targetTableId: linkedTableId,
                fieldName: field.name,
                fieldId: field.id,
                isTwoWay: !!field.options?.inverseLinkFieldId,
              });
            }
          }
        }
      }

      return { tables, relationships };
    } catch (e) {
      logger.error('BaseSchemaMap', 'Error parsing schema:', e);
      return { tables: [], relationships: [] };
    }
  }, [fullBase?.schemaJson]);

  // Count linked-record links per table (links between tables inside this base)
  const linkCounts = useMemo(() => {
    const counts = {};
    for (const rel of relationships) {
      counts[rel.sourceTableId] = (counts[rel.sourceTableId] || 0) + 1;
      counts[rel.targetTableId] = (counts[rel.targetTableId] || 0) + 1;
    }
    return counts;
  }, [relationships]);

  // Count leaf nodes
  const leafNodeCount = useMemo(() => {
    return tables.filter((t) => (linkCounts[t.id] || 0) <= 1).length;
  }, [tables, linkCounts]);

  // Build graph elements
  const elements = useMemo(() => {
    // Filter tables based on hideLeafNodes
    const visibleTables = hideLeafNodes ? tables.filter((t) => (linkCounts[t.id] || 0) > 1) : tables;

    const visibleTableIds = new Set(visibleTables.map((t) => t.id));

    const nodes = visibleTables.map((table) => ({
      data: {
        id: table.id,
        label: table.name,
        fieldCount: table.fields?.length || 0,
        fields: table.fields || [],
        linkCount: linkCounts[table.id] || 0,
      },
    }));

    // Create edges for relationships, avoiding duplicates for two-way links
    const seenPairs = new Set();
    const edges = [];

    for (const rel of relationships) {
      // Skip if either table is hidden
      if (!visibleTableIds.has(rel.sourceTableId) || !visibleTableIds.has(rel.targetTableId)) {
        continue;
      }

      // Create a sorted pair key to avoid duplicate edges
      const pairKey = [rel.sourceTableId, rel.targetTableId].sort().join('-');

      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        edges.push({
          data: {
            id: rel.id,
            source: rel.sourceTableId,
            target: rel.targetTableId,
            label: rel.fieldName,
            isTwoWay: rel.isTwoWay,
          },
        });
      }
    }

    return [...nodes, ...edges];
  }, [tables, relationships, hideLeafNodes, linkCounts]);

  // Get layout configuration
  const getLayoutConfig = useCallback((type) => {
    const configs = {
      cose: {
        name: 'cose',
        nodeRepulsion: 8000,
        idealEdgeLength: 150,
        animate: false,
      },
      concentric: {
        name: 'concentric',
        minNodeSpacing: 80,
        concentric: (node) => node.data('linkCount') || 0,
        levelWidth: () => 2,
        animate: false,
      },
      breadthfirst: {
        name: 'breadthfirst',
        spacingFactor: 1.5,
        directed: false,
        animate: false,
      },
    };
    // Fitting is left to fitGraph so a small schema is not zoomed up to fill the screen
    return { fit: false, nodeDimensionsIncludeLabels: true, ...(configs[type] || configs.cose) };
  }, []);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || elements.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#6366f1',
            label: 'data(label)',
            color: '#e2e8f0',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '12px',
            'font-weight': '500',
            'text-wrap': 'wrap',
            'text-max-width': '100px',
            width: nodeSize,
            height: nodeSize,
            'border-width': 3,
            'border-color': '#4f46e5',
            'transition-property': 'opacity, background-color, border-color',
            'transition-duration': '0.2s',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'background-color': '#818cf8',
            'border-color': '#c7d2fe',
            'border-width': 4,
          },
        },
        {
          selector: 'node.dimmed',
          style: {
            opacity: 0.2,
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'background-color': '#22c55e',
            'border-color': '#16a34a',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#64748b',
            'target-arrow-color': '#64748b',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '10px',
            color: '#94a3b8',
            'text-rotation': 'autorotate',
            'text-margin-y': -10,
            'transition-property': 'opacity, line-color',
            'transition-duration': '0.2s',
          },
        },
        {
          selector: 'edge[?isTwoWay]',
          style: {
            'source-arrow-shape': 'triangle',
            'source-arrow-color': '#64748b',
          },
        },
        {
          selector: 'edge.dimmed',
          style: {
            opacity: 0.1,
          },
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#22c55e',
            'target-arrow-color': '#22c55e',
            'source-arrow-color': '#22c55e',
            width: 3,
          },
        },
      ],
      minZoom: 0.2,
      maxZoom: 2.5,
    });

    cyRef.current = cy;

    // Handle node selection
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const tableData = {
        id: node.id(),
        name: node.data('label'),
        fieldCount: node.data('fieldCount'),
        fields: node.data('fields'),
        linkCount: node.data('linkCount'),
      };
      setSelectedTable(tableData);
    });

    // Clear selection when clicking background
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedTable(null);
      }
    });

    const layout = cy.layout(getLayoutConfig(layoutType));
    layout.one('layoutstop', () => fitGraph(cy, { padding: FIT_PADDING }));
    layout.run();

    return () => {
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [elements, layoutType, getLayoutConfig]);

  // Apply focus mode when selection changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Remove all classes first
    cy.elements().removeClass('dimmed highlighted');

    if (selectedTable && focusMode) {
      const selectedNode = cy.getElementById(selectedTable.id);
      if (selectedNode.length) {
        // Get connected edges and nodes
        const connectedEdges = selectedNode.connectedEdges();
        const connectedNodes = connectedEdges.connectedNodes();

        // Dim everything
        cy.elements().addClass('dimmed');

        // Highlight selected and connected
        selectedNode.removeClass('dimmed');
        connectedNodes.removeClass('dimmed').addClass('highlighted');
        connectedEdges.removeClass('dimmed').addClass('highlighted');
      }
    }
  }, [selectedTable, focusMode]);

  // Opening or closing the table panel resizes the graph area; re-measure and keep the
  // selected table (or the whole schema) in view
  const handleGraphResize = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.resize();
    const selected = cy.nodes(':selected');
    if (selected.length > 0) {
      cy.animate({ center: { eles: selected } }, { duration: 300, easing: 'ease-in-out-cubic' });
    } else {
      fitGraph(cy, { padding: FIT_PADDING, animate: true });
    }
  }, []);
  useResizeObserver(graphAreaRef, handleGraphResize);

  const tableCount = hideLeafNodes ? elements.filter((e) => !e.data.source).length : tables.length;
  const linkCount = elements.filter((e) => e.data.source).length;
  const baseConnectionCount = useMemo(
    () => (base ? getConnectionCounts(baseRelationships)[base.id] || 0 : 0),
    [baseRelationships, base],
  );

  // Get field type display name
  const getFieldTypeLabel = (type) => {
    const typeLabels = {
      singleLineText: 'Text',
      multilineText: 'Long Text',
      email: 'Email',
      url: 'URL',
      number: 'Number',
      currency: 'Currency',
      percent: 'Percent',
      singleSelect: 'Single Select',
      multipleSelects: 'Multi Select',
      date: 'Date',
      dateTime: 'Date Time',
      checkbox: 'Checkbox',
      multipleRecordLinks: 'Linked Record',
      multipleAttachments: 'Attachment',
      formula: 'Formula',
      rollup: 'Rollup',
      lookup: 'Lookup',
      count: 'Count',
      autoNumber: 'Auto Number',
      createdTime: 'Created Time',
      lastModifiedTime: 'Modified Time',
      createdBy: 'Created By',
      lastModifiedBy: 'Modified By',
      rating: 'Rating',
      richText: 'Rich Text',
      duration: 'Duration',
      phoneNumber: 'Phone',
      barcode: 'Barcode',
      button: 'Button',
    };
    return typeLabels[type] || type;
  };

  // Get field type color
  const getFieldTypeColor = (type) => {
    if (type === 'multipleRecordLinks') return 'text-purple-400';
    if (type === 'formula' || type === 'rollup' || type === 'lookup') return 'text-yellow-400';
    if (type === 'singleSelect' || type === 'multipleSelects') return 'text-green-400';
    if (type === 'number' || type === 'currency' || type === 'percent') return 'text-blue-400';
    return 'text-textMuted';
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="h-14 bg-surface border-b border-border flex items-center px-4 gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-textSecondary hover:text-textPrimary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back to Workspace</span>
        </button>
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2">
          {namingConvention?.enabled && (
            <div
              className={`w-3 h-3 rounded-full ${base?.matchesConvention ? 'bg-nodeMatch' : 'bg-nodeOther'}`}
              title={
                base?.matchesConvention ? namingConvention.label : 'Does not match the naming convention'
              }
            />
          )}
          <h2 className="text-lg font-semibold text-textPrimary">{base?.name}</h2>
        </div>
        <span className="text-sm text-textMuted">
          {pluralize(tableCount, 'table')} · {pluralize(linkCount, 'table link')} ·{' '}
          {pluralize(baseConnectionCount, 'connection')} to other bases
        </span>

        <div className="flex-1" />

        {/* View Controls */}
        <div className="flex items-center gap-3">
          {/* Layout selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-textMuted">Layout:</span>
            <select
              value={layoutType}
              onChange={(e) => setLayoutType(e.target.value)}
              className="px-2 py-1 bg-background border border-border rounded text-sm text-textPrimary"
            >
              <option value="cose">Force-Directed</option>
              <option value="concentric">Concentric</option>
              <option value="breadthfirst">Hierarchical</option>
            </select>
          </div>

          <div className="h-6 w-px bg-border" />

          {/* Focus mode toggle */}
          <button
            onClick={() => setFocusMode(!focusMode)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              focusMode ? 'bg-accent text-white' : 'bg-surfaceLight text-textSecondary hover:bg-border'
            }`}
            title="When enabled, selecting a table dims unconnected tables"
          >
            Focus Mode
          </button>

          {/* Hide leaf nodes toggle */}
          {leafNodeCount > 0 && (
            <button
              onClick={() => setHideLeafNodes(!hideLeafNodes)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                hideLeafNodes
                  ? 'bg-warning/20 text-warning'
                  : 'bg-surfaceLight text-textSecondary hover:bg-border'
              }`}
              title="Hide tables with only one link"
            >
              Hide Leaf Nodes ({leafNodeCount})
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Graph */}
        <div ref={graphAreaRef} className="flex-1 relative">
          {loadingSchema ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-textMuted">Loading schema...</p>
            </div>
          ) : tables.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-textMuted">No tables found in this base</p>
            </div>
          ) : (
            <div ref={containerRef} className="absolute inset-0" />
          )}

          {/* Legend */}
          <div className="absolute top-4 left-4 bg-surface/90 backdrop-blur rounded-lg p-3 border border-border">
            <h3 className="text-xs font-medium text-textPrimary mb-2">Legend</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-accent" />
                <span className="text-textSecondary">Table (size = links)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-success" />
                <span className="text-textSecondary">Connected to selected</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-textMuted" />
                <span className="text-textSecondary">One-way link</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center">
                  <div className="w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-textMuted" />
                  <div className="w-3 h-0.5 bg-textMuted" />
                  <div className="w-0 h-0 border-t-4 border-b-4 border-l-4 border-transparent border-l-textMuted" />
                </div>
                <span className="text-textSecondary">Two-way link</span>
              </div>
            </div>
            {focusMode && (
              <p className="text-[10px] text-textMuted mt-2 pt-2 border-t border-border">
                Click a table to focus
              </p>
            )}
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-2">
            <button
              onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)}
              className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center hover:bg-surfaceLight transition-colors"
              title="Zoom in"
            >
              <svg
                className="w-4 h-4 text-textSecondary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
              </svg>
            </button>
            <button
              onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)}
              className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center hover:bg-surfaceLight transition-colors"
              title="Zoom out"
            >
              <svg
                className="w-4 h-4 text-textSecondary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
              </svg>
            </button>
            <button
              onClick={() => fitGraph(cyRef.current, { padding: FIT_PADDING, animate: true })}
              className="w-8 h-8 bg-surface border border-border rounded-lg flex items-center justify-center hover:bg-surfaceLight transition-colors"
              title="Fit to view"
            >
              <svg
                className="w-4 h-4 text-textSecondary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Table detail panel */}
        {selectedTable && (
          <aside className="w-80 bg-surface border-l border-border overflow-y-auto">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-textPrimary">{selectedTable.name}</h3>
              <button
                onClick={() => setSelectedTable(null)}
                className="p-1 rounded hover:bg-surfaceLight transition-colors"
                aria-label="Close panel"
              >
                <svg className="w-4 h-4 text-textMuted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-4">
              <div className="flex gap-4 mb-4">
                <div>
                  <p className="text-lg font-semibold text-textPrimary">{selectedTable.fieldCount}</p>
                  <p className="text-xs text-textMuted">Fields</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-textPrimary">{selectedTable.linkCount || 0}</p>
                  <p className="text-xs text-textMuted">Links</p>
                </div>
              </div>

              <div className="space-y-2">
                {selectedTable.fields.map((field) => (
                  <div key={field.id} className="p-2 bg-background rounded-lg border border-border">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-textPrimary font-medium">{field.name}</span>
                      <span className={`text-xs ${getFieldTypeColor(field.type)}`}>
                        {getFieldTypeLabel(field.type)}
                      </span>
                    </div>
                    {field.type === 'multipleRecordLinks' && field.options?.linkedTableId && (
                      <p className="text-xs text-purple-400 mt-1">
                        → {tables.find((t) => t.id === field.options.linkedTableId)?.name || 'Unknown table'}
                      </p>
                    )}
                    {field.description && <p className="text-xs text-textMuted mt-1">{field.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default BaseSchemaMap;
