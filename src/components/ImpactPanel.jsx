import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';

/**
 * Criticality score badge with color coding.
 */
function CriticalityBadge({ score }) {
  let label, classes;
  if (score >= 5) {
    label = 'Critical';
    classes = 'bg-error/30 text-error animate-pulse';
  } else if (score >= 3) {
    label = 'High';
    classes = 'bg-error/20 text-error';
  } else if (score >= 1) {
    label = 'Medium';
    classes = 'bg-warning/20 text-warning';
  } else {
    label = 'Low';
    classes = 'bg-success/20 text-success';
  }

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${classes}`}>
      {label} ({score.toFixed(1)})
    </span>
  );
}

/**
 * Role label: Hub, Leaf, or Intermediate.
 */
function RoleBadge({ isHub, isLeaf }) {
  if (isHub) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent/20 text-accent">Hub</span>;
  }
  if (isLeaf) {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surfaceLight text-textMuted">
        Leaf
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surfaceLight text-textSecondary">
      Intermediate
    </span>
  );
}

/**
 * ImpactPanel - Shows dependency analysis for a selected base.
 * Displays criticality score, upstream/downstream bases, and circular dependency warnings.
 */
export function ImpactPanel({ selectedBase, relationships, bases, onSelectBase }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [impactReport, setImpactReport] = useState(null);
  const [circularDeps, setCircularDeps] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const selectedBaseId = selectedBase?.id;

  // Load impact report when the selected base changes or relationships are re-detected
  useEffect(() => {
    if (!selectedBaseId) {
      setImpactReport(null);
      setCircularDeps([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    async function loadAnalysis() {
      try {
        const [reportResult, circularResult] = await Promise.all([
          window.api.getImpactReport(selectedBaseId),
          window.api.detectCircularDeps(),
        ]);

        if (cancelled) return;

        if (reportResult.success) {
          setImpactReport(reportResult.data);
        }
        if (circularResult.success) {
          // Filter to only cycles involving this base
          const relevant = (circularResult.data || []).filter((cycle) => cycle.path.includes(selectedBaseId));
          setCircularDeps(relevant);
        }
      } catch (err) {
        logger.error('ImpactPanel', 'Error loading impact analysis:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, [selectedBaseId, relationships]);

  // Get base name by ID
  const getBaseName = (baseId) => {
    const base = bases.find((b) => b.id === baseId);
    return base?.name || baseId;
  };

  if (!selectedBase) return null;

  return (
    <div className="p-4 border-b border-border">
      {/* Section Header - collapsible */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between mb-3"
      >
        <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider">Impact Analysis</h3>
        <svg
          className={`w-4 h-4 text-textMuted transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!isCollapsed && (
        <>
          {isLoading ? (
            <div className="text-sm text-textMuted">Analyzing dependencies...</div>
          ) : !impactReport ? (
            <div className="text-sm text-textMuted">No analysis available.</div>
          ) : (
            <div className="space-y-3">
              {/* Criticality + Role badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <CriticalityBadge score={impactReport.criticalityScore} />
                <RoleBadge isHub={impactReport.isHub} isLeaf={impactReport.isLeaf} />
                <span className="text-xs text-textMuted">{impactReport.totalAffected} connected</span>
              </div>

              {/* Circular dependency warning */}
              {circularDeps.length > 0 && (
                <div className="bg-error/10 border border-error/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <svg
                      className="w-4 h-4 text-error shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                    <span className="text-xs font-medium text-error">Circular Dependencies Detected</span>
                  </div>
                  {circularDeps.map((cycle, i) => (
                    <div key={i} className="text-xs text-error/80 mt-1">
                      {cycle.path.map((id) => getBaseName(id)).join(' -> ')}
                    </div>
                  ))}
                </div>
              )}

              {/* Upstream sources */}
              <div>
                <div className="text-xs text-textMuted mb-1">Depends on ({impactReport.upstream.length})</div>
                {impactReport.upstream.length === 0 ? (
                  <div className="text-xs text-textMuted/60 ml-2">None</div>
                ) : (
                  <div className="space-y-1">
                    {impactReport.upstream.map((item) => (
                      <button
                        key={item.baseId}
                        onClick={() => {
                          const base = bases.find((b) => b.id === item.baseId);
                          if (base && onSelectBase) onSelectBase(base);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 bg-background rounded hover:bg-surfaceLight transition-colors text-left"
                      >
                        <svg
                          className="w-3 h-3 text-accent shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 19l-7-7m0 0l7-7m-7 7h18"
                          />
                        </svg>
                        <span className="text-sm text-textPrimary truncate">{item.name}</span>
                        {item.depth > 1 && (
                          <span className="text-[10px] text-textMuted shrink-0">depth {item.depth}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Downstream dependents */}
              <div>
                <div className="text-xs text-textMuted mb-1">
                  Depended on by ({impactReport.downstream.length})
                </div>
                {impactReport.downstream.length === 0 ? (
                  <div className="text-xs text-textMuted/60 ml-2">None</div>
                ) : (
                  <div className="space-y-1">
                    {impactReport.downstream.map((item) => (
                      <button
                        key={item.baseId}
                        onClick={() => {
                          const base = bases.find((b) => b.id === item.baseId);
                          if (base && onSelectBase) onSelectBase(base);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 bg-background rounded hover:bg-surfaceLight transition-colors text-left"
                      >
                        <svg
                          className="w-3 h-3 text-success shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M14 5l7 7m0 0l-7 7m7-7H3"
                          />
                        </svg>
                        <span className="text-sm text-textPrimary truncate">{item.name}</span>
                        {item.depth > 1 && (
                          <span className="text-[10px] text-textMuted shrink-0">depth {item.depth}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ImpactPanel;
