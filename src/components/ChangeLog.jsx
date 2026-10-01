import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { parseTimestamp, pluralize } from '../utils/format';
import { logger } from '../utils/logger';

export function ChangeLog({ isOpen, onClose }) {
  const { bases } = useAppContext();
  const [snapshots, setSnapshots] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterBase, setFilterBase] = useState('all');
  const [expandedSnapshot, setExpandedSnapshot] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSnapshots();
    }
  }, [isOpen]);

  const loadSnapshots = async () => {
    setIsLoading(true);
    try {
      const result = await window.api.getAllSnapshots(100);
      if (result.success) {
        setSnapshots(result.data);
      }
    } catch (err) {
      logger.error('ChangeLog', 'Error loading snapshots:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDiff = async (snapshot) => {
    if (expandedSnapshot === snapshot.id) {
      setExpandedSnapshot(null);
      setDiffData(null);
      return;
    }

    setExpandedSnapshot(snapshot.id);
    setDiffLoading(true);

    try {
      // Compare this snapshot to the next one (or current if it's the most recent)
      const baseSnapshots = snapshots.filter((s) => s.baseId === snapshot.baseId);
      const currentIndex = baseSnapshots.findIndex((s) => s.id === snapshot.id);
      const nextSnapshot = currentIndex > 0 ? baseSnapshots[currentIndex - 1] : null;

      const result = await window.api.compareSnapshots(
        snapshot.baseId,
        snapshot.id,
        nextSnapshot?.id || 'current',
      );

      if (result.success) {
        // Map schemaDiff output structure to the format our template expects
        const raw = result.data;
        setDiffData({
          addedTables: raw.tables?.added || [],
          removedTables: raw.tables?.removed || [],
          modifiedTables: (raw.tables?.modified || []).map((t) => ({
            id: t.id,
            name: t.name,
            oldName: t.oldName,
            addedFields: t.changes?.fields?.added || [],
            removedFields: t.changes?.fields?.removed || [],
            modifiedFields: t.changes?.fields?.modified || [],
          })),
          addedFields: raw.fields?.added || [],
          removedFields: raw.fields?.removed || [],
          modifiedFields: raw.fields?.modified || [],
          summary: raw.summary || {},
        });
      }
    } catch (err) {
      logger.error('ChangeLog', 'Error loading diff:', err);
    } finally {
      setDiffLoading(false);
    }
  };

  // Group snapshots by date
  const groupedSnapshots = useMemo(() => {
    const filtered = filterBase === 'all' ? snapshots : snapshots.filter((s) => s.baseId === filterBase);

    const groups = {};
    for (const snapshot of filtered) {
      const date = parseTimestamp(snapshot.pulledAt)?.toLocaleDateString() ?? '';
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(snapshot);
    }
    return groups;
  }, [snapshots, filterBase]);

  const formatTime = (dateString) => {
    return parseTimestamp(dateString)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-textPrimary">Change Log</h2>
            <p className="text-sm text-textMuted">Schema changes across all bases</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-surfaceLight transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-textMuted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filter */}
        <div className="p-4 border-b border-border">
          <select
            value={filterBase}
            onChange={(e) => setFilterBase(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary"
          >
            <option value="all">All Bases</option>
            {bases.map((base) => (
              <option key={base.id} value={base.id}>
                {base.name}
              </option>
            ))}
          </select>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : Object.keys(groupedSnapshots).length === 0 ? (
            <div className="text-center py-8 text-textMuted">No schema changes recorded yet.</div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedSnapshots).map(([date, dateSnapshots]) => (
                <div key={date}>
                  <div className="text-sm font-medium text-textMuted mb-3">{date}</div>
                  <div className="space-y-2">
                    {dateSnapshots.map((snapshot) => (
                      <div key={snapshot.id} className="bg-background rounded-lg overflow-hidden">
                        <button
                          onClick={() => loadDiff(snapshot)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-surfaceLight transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-accent/20 flex items-center justify-center">
                              <svg
                                className="w-4 h-4 text-accent"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                />
                              </svg>
                            </div>
                            <div className="text-left">
                              <div className="text-sm font-medium text-textPrimary">
                                {snapshot.baseName || 'Unknown Base'}
                              </div>
                              <div className="text-xs text-textMuted">
                                Schema snapshot at {formatTime(snapshot.pulledAt)}
                              </div>
                            </div>
                          </div>
                          <svg
                            className={`w-4 h-4 text-textMuted transition-transform ${expandedSnapshot === snapshot.id ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </button>

                        {expandedSnapshot === snapshot.id && (
                          <div className="px-4 pb-4 border-t border-border">
                            {diffLoading ? (
                              <div className="py-4 text-center">
                                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
                              </div>
                            ) : diffData ? (
                              <div className="pt-3 space-y-3">
                                {diffData.addedTables?.length > 0 && (
                                  <div>
                                    <div className="text-xs font-medium text-success mb-1">Added Tables</div>
                                    {diffData.addedTables.map((t) => (
                                      <div key={t.id} className="text-sm text-textSecondary pl-2">
                                        + {t.name}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {diffData.removedTables?.length > 0 && (
                                  <div>
                                    <div className="text-xs font-medium text-error mb-1">Removed Tables</div>
                                    {diffData.removedTables.map((t) => (
                                      <div key={t.id} className="text-sm text-textSecondary pl-2">
                                        - {t.name}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {diffData.modifiedTables?.length > 0 && (
                                  <div>
                                    <div className="text-xs font-medium text-warning mb-1">
                                      Modified Tables
                                    </div>
                                    {diffData.modifiedTables.map((t) => (
                                      <div key={t.id} className="text-sm text-textSecondary pl-2">
                                        <div>
                                          ~ {t.name}
                                          {t.oldName && (
                                            <span className="text-textMuted ml-1">(was: {t.oldName})</span>
                                          )}
                                        </div>
                                        {t.addedFields?.length > 0 && (
                                          <div className="text-success pl-2">
                                            +{pluralize(t.addedFields.length, 'field')}:{' '}
                                            {t.addedFields.map((f) => f.name).join(', ')}
                                          </div>
                                        )}
                                        {t.removedFields?.length > 0 && (
                                          <div className="text-error pl-2">
                                            -{pluralize(t.removedFields.length, 'field')}:{' '}
                                            {t.removedFields.map((f) => f.name).join(', ')}
                                          </div>
                                        )}
                                        {t.modifiedFields?.length > 0 && (
                                          <div className="text-accent pl-2">
                                            ~{pluralize(t.modifiedFields.length, 'field')} changed:{' '}
                                            {t.modifiedFields.map((f) => f.name).join(', ')}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {!diffData.addedTables?.length &&
                                  !diffData.removedTables?.length &&
                                  !diffData.modifiedTables?.length && (
                                    <div className="text-sm text-textMuted">
                                      No significant changes detected
                                    </div>
                                  )}
                              </div>
                            ) : (
                              <div className="py-2 text-sm text-textMuted">Could not load changes</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChangeLog;
