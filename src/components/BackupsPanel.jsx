import React, { useCallback, useEffect, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { formatBytes, parseTimestamp, pluralize } from '../utils/format';
import { logger } from '../utils/logger';

function formatDateTime(iso) {
  return parseTimestamp(iso)?.toLocaleString() ?? '';
}

function describeChanges(counts) {
  const parts = [];
  if (counts.created) parts.push(`${counts.created} added`);
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.deleted) parts.push(`${counts.deleted} deleted`);
  return parts.length > 0 ? parts.join(', ') : 'No changes';
}

// A run can stay marked running after a crash or a failed cleanup, so only
// the app's own running flag may say a backup is in progress.
function StatusLine({ summary, isRunning }) {
  const { lastRun, lastComplete } = summary;
  if (!lastRun) return <span className="text-textMuted">Not backed up yet</span>;
  if (lastRun.status === 'running' && isRunning) return <span className="text-accent">Backing up now</span>;
  if (lastRun.status !== 'complete') return <span className="text-warning">Last backup didn't finish</span>;
  return <span className="text-success">Backed up {formatDateTime(lastComplete?.finishedAt)}</span>;
}

function BaseCard({ summary, isRunning, isSelected, onSelect }) {
  const failure = summary.lastRun?.status === 'incomplete' ? summary.lastRun.error : null;
  const filesFailed = summary.lastRun?.status === 'complete' ? summary.lastRun.counts.filesFailed : 0;

  return (
    <div
      data-testid="backup-card"
      className={`rounded-lg border p-4 transition-colors ${
        isSelected ? 'border-accent bg-accent/10' : 'border-border bg-background hover:border-accent/50'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(summary.baseId)}
        aria-pressed={isSelected}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-textPrimary truncate">{summary.baseName}</span>
          <span className="text-xs text-textMuted shrink-0">
            {pluralize(summary.restorePointCount, 'restore point')}
          </span>
        </div>
        <div className="text-sm mt-1">
          <StatusLine summary={summary} isRunning={isRunning} />
        </div>
        {summary.lastComplete && (
          <div className="text-xs text-textMuted mt-2">
            {pluralize(summary.recordCount, 'record')}
            {summary.fileCount > 0 &&
              ` · ${pluralize(summary.fileCount, 'file')} (${formatBytes(summary.fileBytes)})`}
          </div>
        )}
      </button>
      {failure && (
        <div className="mt-3 text-xs text-textSecondary bg-warning/10 border border-warning/30 rounded-lg p-3">
          <p>{failure.message}</p>
          {failure.helpUrl && (
            <a
              href={failure.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 text-accent hover:underline"
            >
              Open Airtable token settings
            </a>
          )}
        </div>
      )}
      {filesFailed > 0 && (
        <p className="mt-3 text-xs text-warning">
          {pluralize(filesFailed, 'file')} couldn't be saved last time. The next backup will try again.
        </p>
      )}
    </div>
  );
}

function RestorePointList({ baseName, points }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-textMuted">No restore points yet. Run a backup to create the first one.</p>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold text-textPrimary mb-3">Restore points for {baseName}</h3>
      <ol className="space-y-2">
        {points.map((point) => (
          <li
            key={point.id}
            className="bg-background rounded-lg px-4 py-3 flex items-center justify-between gap-3"
          >
            <div>
              <div className="text-sm text-textPrimary">{formatDateTime(point.finishedAt)}</div>
              <div className="text-xs text-textMuted">{describeChanges(point.counts)}</div>
            </div>
            <span className="text-xs text-textMuted shrink-0">
              {pluralize(point.counts.records, 'record')}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BackupsPanel({ isOpen, onClose }) {
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedBaseId, setSelectedBaseId] = useState(null);
  const [restorePoints, setRestorePoints] = useState([]);
  const [restorePointsError, setRestorePointsError] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [runMessage, setRunMessage] = useState(null);
  const [finishedRuns, setFinishedRuns] = useState(0);

  const loadOverview = useCallback(async () => {
    try {
      const result = await window.api.getBackupOverview();
      if (!result.success) {
        setLoadError(result.error || 'Could not load your backups.');
        return;
      }
      setLoadError(null);
      setOverview(result.data);
      setIsRunning(result.data.isRunning);
      setSelectedBaseId((current) => current ?? result.data.bases[0]?.baseId ?? null);
    } catch (err) {
      logger.error('Backups', 'Could not load backups:', err);
      setLoadError(err.message);
    }
  }, []);

  const loadRestorePoints = useCallback(async (baseId) => {
    try {
      const result = await window.api.getRestorePoints(baseId);
      if (!result.success) {
        setRestorePointsError(result.error || 'Try again.');
        setRestorePoints([]);
        return;
      }
      setRestorePointsError(null);
      setRestorePoints(result.data);
    } catch (err) {
      logger.error('Backups', 'Could not load restore points:', err);
      setRestorePointsError(err.message || 'Try again.');
      setRestorePoints([]);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadOverview();
  }, [isOpen, loadOverview]);

  useEffect(() => {
    if (isOpen && selectedBaseId) loadRestorePoints(selectedBaseId);
  }, [isOpen, selectedBaseId, loadRestorePoints, finishedRuns]);

  useEffect(() => {
    if (!isOpen) return undefined;
    // Progress can come from a backup this panel didn't start (one already
    // running when it opened), so the events drive the running state too.
    return window.api.onBackupProgress((data) => {
      if (data.phase === 'finished') {
        setProgress(null);
        setIsRunning(false);
        loadOverview();
        setFinishedRuns((n) => n + 1);
      } else {
        setProgress(data);
        setIsRunning(true);
      }
    });
  }, [isOpen, loadOverview]);

  useEscapeKey(onClose, isOpen);

  const handleBackupNow = async () => {
    setIsRunning(true);
    setRunMessage(null);
    try {
      const result = await window.api.backupNow();
      if (!result.success) {
        setRunMessage({ tone: 'error', text: result.error });
      } else {
        const details = result.data.results.filter((r) => r.status !== 'complete');
        const unfinished = details.length;
        setRunMessage(
          unfinished > 0
            ? {
                tone: 'warning',
                text: `${pluralize(unfinished, 'base')} didn't finish.`,
                details,
              }
            : {
                tone: 'success',
                text: `Backup finished: ${pluralize(result.data.results.length, 'base')} saved.`,
              },
        );
      }
    } catch (err) {
      logger.error('Backups', 'Backup failed:', err);
      setRunMessage({ tone: 'error', text: err.message });
    } finally {
      setIsRunning(false);
      setProgress(null);
      await loadOverview();
      if (selectedBaseId) await loadRestorePoints(selectedBaseId);
    }
  };

  if (!isOpen) return null;

  const bases = overview?.bases || [];
  const selected = bases.find((b) => b.baseId === selectedBaseId);
  const messageTone = { success: 'text-success', warning: 'text-warning', error: 'text-error' };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-5xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-textPrimary">Backups</h2>
              <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-accent/15 text-accent">
                Preview
              </span>
            </div>
            <p className="text-sm text-textMuted">
              Copies of every record and file, kept on this computer. Restoring from a backup arrives in the
              next release.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBackupNow}
              disabled={isRunning || bases.length === 0}
              className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Backing up...' : 'Back up now'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close backups"
              className="p-2 rounded-lg text-textMuted hover:text-textPrimary hover:bg-surfaceLight transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {(progress || runMessage) && (
          <div className="px-4 py-2 border-b border-border text-sm shrink-0" role="status">
            {progress ? (
              <span className="text-textSecondary">
                Backing up {progress.baseName} ({progress.basesDone + 1} of {progress.basesTotal})
                {progress.records ? ` · ${pluralize(progress.records, 'record')} so far` : ''}
              </span>
            ) : (
              <div className={messageTone[runMessage.tone]}>
                <span>{runMessage.text}</span>
                {runMessage.details?.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto space-y-2 pr-1">
                    {runMessage.details.map((detail) => (
                      <div key={detail.baseId} className="text-textSecondary">
                        <p>
                          <span className="font-medium">{detail.baseName}</span>:{' '}
                          <span>
                            {detail.error?.message || 'Nothing was saved for this base. Try again.'}
                          </span>
                        </p>
                        {detail.error?.helpUrl && (
                          <a
                            href={detail.error.helpUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block mt-2 text-accent hover:underline"
                          >
                            Open Airtable token settings
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loadError ? (
            <p className="text-error text-sm">{loadError}</p>
          ) : !overview ? (
            <p className="text-textMuted text-sm">Loading backups...</p>
          ) : bases.length === 0 ? (
            <p className="text-textMuted text-sm">
              No bases to back up yet. Refresh your workspace to load your bases.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                {bases.map((summary) => (
                  <BaseCard
                    key={summary.baseId}
                    summary={summary}
                    isRunning={isRunning}
                    isSelected={summary.baseId === selectedBaseId}
                    onSelect={setSelectedBaseId}
                  />
                ))}
              </div>
              <div>
                {selected &&
                  (restorePointsError ? (
                    <p className="text-error text-sm">
                      Couldn't load restore points for {selected.baseName}. {restorePointsError}
                    </p>
                  ) : (
                    <RestorePointList baseName={selected.baseName} points={restorePoints} />
                  ))}
              </div>
            </div>
          )}
        </div>

        {overview?.folder && (
          <div className="px-4 py-3 border-t border-border text-xs text-textMuted break-all">
            Saved in {overview.folder}
          </div>
        )}
      </div>
    </div>
  );
}

export default BackupsPanel;
