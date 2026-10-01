import React, { useState, useEffect } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { parseTimestamp, pluralize } from '../utils/format';

function StatCard({ label, value, sublabel }) {
  return (
    <div className="bg-background rounded-lg p-3 flex flex-col">
      <span className="text-xs text-textMuted uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-bold text-textPrimary mt-1">{value}</span>
      {sublabel && <span className="text-xs text-textMuted mt-0.5">{sublabel}</span>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 className="text-sm font-semibold text-textPrimary mt-5 mb-2 uppercase tracking-wider">{children}</h3>
  );
}

export function WorkspaceHealth({ isOpen, onClose }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadStats();
    }
  }, [isOpen]);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.getHealthStats();
      if (result.success) {
        setStats(result.data);
      } else {
        setError(result.error || 'Failed to load health stats');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-textPrimary">Workspace Health</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surfaceLight transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-textMuted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
              <span className="ml-3 text-textMuted text-sm">Loading health stats...</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {stats && !loading && (
            <>
              {/* Overview */}
              <SectionTitle>Overview</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label="Bases" value={stats.overview.totalBases} />
                <StatCard label="Tables" value={stats.overview.totalTables} />
                <StatCard label="Fields" value={stats.overview.totalFields} />
                <StatCard label="Relationships" value={stats.overview.totalRelationships} />
                <StatCard
                  label="Last Sync"
                  value={parseTimestamp(stats.overview.lastSyncTime)?.toLocaleDateString() ?? '--'}
                  sublabel={
                    parseTimestamp(stats.overview.lastSyncTime)?.toLocaleTimeString() ?? 'Never synced'
                  }
                />
              </div>

              {/* Change Summary */}
              <SectionTitle>Recent Changes</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="Changed (7 days)"
                  value={stats.changes.last7Days}
                  sublabel="bases with schema changes"
                />
                <StatCard
                  label="Changed (30 days)"
                  value={stats.changes.last30Days}
                  sublabel="bases with schema changes"
                />
              </div>

              {/* Relationship Health */}
              <SectionTitle>Relationship Health</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Sync" value={stats.relationshipHealth.byType.sync} />
                <StatCard label="Link" value={stats.relationshipHealth.byType.link} />
                <StatCard label="Structural" value={stats.relationshipHealth.byType.structural} />
                <StatCard
                  label="Circular Deps"
                  value={stats.relationshipHealth.circularCount}
                  sublabel={stats.relationshipHealth.circularCount > 0 ? 'needs attention' : 'none detected'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <StatCard label="Confirmed" value={stats.relationshipHealth.byConfidence.confirmed} />
                <StatCard label="Suspected" value={stats.relationshipHealth.byConfidence.suspected} />
              </div>

              {/* Top Changers */}
              {stats.topChangers.length > 0 && (
                <>
                  <SectionTitle>Top Changers</SectionTitle>
                  <div className="bg-background rounded-lg divide-y divide-border">
                    {stats.topChangers.map((item, i) => (
                      <div key={item.baseId} className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-textMuted w-4">{i + 1}.</span>
                          <span className="text-sm text-textPrimary">{item.baseName}</span>
                        </div>
                        <span className="text-xs text-textMuted">
                          {pluralize(item.snapshotCount, 'change')}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Schema Complexity */}
              <SectionTitle>Schema Complexity</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label="Avg Fields/Table" value={stats.complexity.avgFieldsPerTable} />
                {stats.complexity.largestBase && (
                  <StatCard
                    label="Largest Base"
                    value={stats.complexity.largestBase.tableCount}
                    sublabel={stats.complexity.largestBase.name}
                  />
                )}
                {stats.complexity.mostConnectedBase && (
                  <StatCard
                    label="Most Connected"
                    value={stats.complexity.mostConnectedBase.connections}
                    sublabel={stats.complexity.mostConnectedBase.name}
                  />
                )}
              </div>

              {/* Anomalies */}
              {stats.anomalies.length > 0 && (
                <>
                  <SectionTitle>Anomaly Indicators</SectionTitle>
                  <div className="space-y-2">
                    {stats.anomalies.map((item) => (
                      <div
                        key={item.baseId}
                        className="bg-warning/10 border border-warning/20 rounded-lg px-3 py-2 flex items-start justify-between"
                      >
                        <span className="text-sm text-textPrimary">{item.baseName}</span>
                        <div className="flex flex-wrap gap-1 ml-2">
                          {item.flags.map((flag) => (
                            <span
                              key={flag}
                              className="text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded"
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {stats.anomalies.length === 0 && (
                <>
                  <SectionTitle>Anomaly Indicators</SectionTitle>
                  <p className="text-sm text-textMuted">
                    No anomalies detected. All bases are within normal complexity thresholds.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceHealth;
