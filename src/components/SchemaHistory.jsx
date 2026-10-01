import React, { useState, useEffect, useCallback } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { parseTimestamp, pluralize } from '../utils/format';
import { logger } from '../utils/logger';

export function SchemaHistory({ base, isOpen, onClose }) {
  const [snapshots, setSnapshots] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [compareWith, setCompareWith] = useState('current');
  const [diff, setDiff] = useState(null);
  const [isComparing, setIsComparing] = useState(false);

  const baseId = base?.id;

  const loadSnapshots = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.api.getSnapshots(baseId, 20);
      if (result.success) {
        setSnapshots(result.data);
        if (result.data.length > 0) {
          setSelectedSnapshot(result.data[0].id);
        }
      }
    } catch (err) {
      logger.error('SchemaHistory', 'Error loading snapshots:', err);
    } finally {
      setIsLoading(false);
    }
  }, [baseId]);

  useEffect(() => {
    if (isOpen && baseId) {
      loadSnapshots();
    }
  }, [isOpen, baseId, loadSnapshots]);

  const handleCompare = async () => {
    if (!selectedSnapshot) return;
    setIsComparing(true);
    try {
      const result = await window.api.compareSnapshots(base.id, selectedSnapshot, compareWith);
      if (result.success) {
        setDiff(result.data);
      }
    } catch (err) {
      logger.error('SchemaHistory', 'Error comparing snapshots:', err);
    } finally {
      setIsComparing(false);
    }
  };

  const formatDate = (dateStr) => {
    const date = parseTimestamp(dateStr);
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-textPrimary">Schema History</h2>
            <p className="text-sm text-textMuted">{base?.name}</p>
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
        <div className="flex-1 overflow-hidden flex">
          {/* Snapshots list */}
          <div className="w-64 border-r border-border flex flex-col">
            <div className="p-3 border-b border-border">
              <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider">Snapshots</h3>
            </div>
            {isLoading ? (
              <div className="p-4 text-center text-textMuted">Loading...</div>
            ) : snapshots.length === 0 ? (
              <div className="p-4 text-center text-textMuted text-sm">
                No snapshots yet. Snapshots are created when schema changes are detected during refresh.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {snapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    onClick={() => setSelectedSnapshot(snapshot.id)}
                    className={`w-full px-3 py-2 text-left border-b border-border transition-colors ${
                      selectedSnapshot === snapshot.id
                        ? 'bg-accent/20 border-l-2 border-l-accent'
                        : 'hover:bg-surfaceLight border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="text-sm text-textPrimary">{formatDate(snapshot.pulledAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compare section */}
          <div className="flex-1 flex flex-col">
            {snapshots.length > 0 && (
              <>
                {/* Compare controls */}
                <div className="p-4 border-b border-border flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-textMuted">Compare with:</span>
                    <select
                      value={compareWith}
                      onChange={(e) => setCompareWith(e.target.value)}
                      className="px-2 py-1 bg-background border border-border rounded text-sm text-textPrimary"
                    >
                      <option value="current">Current Schema</option>
                      {snapshots
                        .filter((s) => s.id !== selectedSnapshot)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {formatDate(s.pulledAt)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <button
                    onClick={handleCompare}
                    disabled={!selectedSnapshot || isComparing}
                    className="px-3 py-1 bg-accent hover:bg-accentHover text-white text-sm rounded disabled:opacity-50"
                  >
                    {isComparing ? 'Comparing...' : 'Compare'}
                  </button>
                </div>

                {/* Diff results */}
                <div className="flex-1 overflow-y-auto p-4">
                  {!diff ? (
                    <div className="text-center text-textMuted py-8">
                      Select a snapshot and click Compare to see changes
                    </div>
                  ) : !diff.summary.hasChanges ? (
                    <div className="text-center text-textMuted py-8">No changes between these versions</div>
                  ) : (
                    <div className="space-y-6">
                      {/* Summary */}
                      <div className="bg-background rounded-lg p-4">
                        <h4 className="text-sm font-medium text-textPrimary mb-2">Summary</h4>
                        <div className="flex gap-4">
                          <div className="text-sm">
                            <span className="text-textMuted">Tables: </span>
                            <span className="text-success">+{diff.tables.added.length}</span>
                            <span className="text-textMuted">/</span>
                            <span className="text-error">-{diff.tables.removed.length}</span>
                            <span className="text-textMuted">/</span>
                            <span className="text-warning">~{diff.tables.modified.length}</span>
                          </div>
                          <div className="text-sm">
                            <span className="text-textMuted">Fields: </span>
                            <span className="text-success">+{diff.fields.added.length}</span>
                            <span className="text-textMuted">/</span>
                            <span className="text-error">-{diff.fields.removed.length}</span>
                            <span className="text-textMuted">/</span>
                            <span className="text-warning">~{diff.fields.modified.length}</span>
                          </div>
                        </div>
                      </div>

                      {/* Tables Added */}
                      {diff.tables.added.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-success mb-2">Tables Added</h4>
                          <div className="space-y-1">
                            {diff.tables.added.map((table) => (
                              <div
                                key={table.id}
                                className="bg-success/10 border border-success/30 rounded px-3 py-2"
                              >
                                <span className="text-sm text-textPrimary">{table.name}</span>
                                <span className="text-xs text-textMuted ml-2">
                                  ({pluralize(table.fieldCount, 'field')})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tables Removed */}
                      {diff.tables.removed.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-error mb-2">Tables Removed</h4>
                          <div className="space-y-1">
                            {diff.tables.removed.map((table) => (
                              <div
                                key={table.id}
                                className="bg-error/10 border border-error/30 rounded px-3 py-2"
                              >
                                <span className="text-sm text-textPrimary line-through">{table.name}</span>
                                <span className="text-xs text-textMuted ml-2">
                                  ({pluralize(table.fieldCount, 'field')})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Fields Added */}
                      {diff.fields.added.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-success mb-2">Fields Added</h4>
                          <div className="space-y-1">
                            {diff.fields.added.map((field, idx) => (
                              <div
                                key={idx}
                                className="bg-success/10 border border-success/30 rounded px-3 py-2 flex items-center gap-2"
                              >
                                <span className="text-xs text-textMuted">{field.tableName}.</span>
                                <span className="text-sm text-textPrimary">{field.name}</span>
                                <span className="text-xs px-1.5 py-0.5 bg-surfaceLight rounded">
                                  {field.type}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Fields Removed */}
                      {diff.fields.removed.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-error mb-2">Fields Removed</h4>
                          <div className="space-y-1">
                            {diff.fields.removed.map((field, idx) => (
                              <div
                                key={idx}
                                className="bg-error/10 border border-error/30 rounded px-3 py-2 flex items-center gap-2"
                              >
                                <span className="text-xs text-textMuted">{field.tableName}.</span>
                                <span className="text-sm text-textPrimary line-through">{field.name}</span>
                                <span className="text-xs px-1.5 py-0.5 bg-surfaceLight rounded">
                                  {field.type}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Fields Modified */}
                      {diff.fields.modified.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-warning mb-2">Fields Modified</h4>
                          <div className="space-y-1">
                            {diff.fields.modified.map((field, idx) => (
                              <div
                                key={idx}
                                className="bg-warning/10 border border-warning/30 rounded px-3 py-2"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-textMuted">{field.tableName}.</span>
                                  {field.oldName ? (
                                    <>
                                      <span className="text-sm text-textMuted line-through">
                                        {field.oldName}
                                      </span>
                                      <span className="text-textMuted">→</span>
                                      <span className="text-sm text-textPrimary">{field.name}</span>
                                    </>
                                  ) : (
                                    <span className="text-sm text-textPrimary">{field.name}</span>
                                  )}
                                  {field.oldType && (
                                    <span className="text-xs text-textMuted">
                                      ({field.oldType} → {field.type})
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default SchemaHistory;
