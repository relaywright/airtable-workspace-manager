import React, { useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';

export function ExportModal({ isOpen, onClose, onExportMap, filteredBaseIds, selectedBaseId }) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const [filterScope, setFilterScope] = useState('all');

  // Determine which base IDs to pass based on filter scope
  const getFilterIds = () => {
    if (filterScope === 'filtered' && filteredBaseIds && filteredBaseIds.length > 0) {
      return filteredBaseIds;
    }
    if (filterScope === 'selected' && selectedBaseId) {
      return [selectedBaseId];
    }
    return null; // null = all bases
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    setExportStatus(null);
    try {
      const result = await window.api.exportInventoryCsv(getFilterIds());
      if (!result.success) {
        throw new Error(result.error);
      }

      const saveResult = await window.api.saveFile({
        title: 'Export Base Inventory',
        defaultPath: 'airtable-inventory.csv',
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      });

      if (saveResult.canceled) {
        setExportStatus({ type: 'info', message: 'Export canceled' });
        return;
      }

      const writeResult = await window.api.writeFile(saveResult.filePath, result.data);
      if (!writeResult?.success) {
        throw new Error(writeResult?.error || 'Could not write the file');
      }
      setExportStatus({ type: 'success', message: 'CSV exported successfully!' });
    } catch (err) {
      setExportStatus({ type: 'error', message: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJson = async () => {
    setIsExporting(true);
    setExportStatus(null);
    try {
      const result = await window.api.exportInventoryJson(getFilterIds());
      if (!result.success) {
        throw new Error(result.error);
      }

      const saveResult = await window.api.saveFile({
        title: 'Export Full Backup',
        defaultPath: 'airtable-workspace-backup.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });

      if (saveResult.canceled) {
        setExportStatus({ type: 'info', message: 'Export canceled' });
        return;
      }

      const writeResult = await window.api.writeFile(saveResult.filePath, result.data);
      if (!writeResult?.success) {
        throw new Error(writeResult?.error || 'Could not write the file');
      }
      setExportStatus({ type: 'success', message: 'JSON exported successfully!' });
    } catch (err) {
      setExportStatus({ type: 'error', message: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMap = async () => {
    setIsExporting(true);
    setExportStatus(null);
    try {
      if (!onExportMap) {
        throw new Error('Map export not available');
      }

      const pngData = await onExportMap();
      if (!pngData) {
        throw new Error('Could not generate map image');
      }

      const saveResult = await window.api.saveFile({
        title: 'Export Workspace Map',
        defaultPath: 'workspace-map.png',
        filters: [{ name: 'PNG Images', extensions: ['png'] }],
      });

      if (saveResult.canceled) {
        setExportStatus({ type: 'info', message: 'Export canceled' });
        return;
      }

      // The context-isolated renderer has no Node Buffer; decode to a Uint8Array,
      // which survives IPC structured cloning and fs.writeFileSync accepts as-is.
      const base64Data = pngData.replace(/^data:image\/png;base64,/, '');
      const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      const writeResult = await window.api.writeFile(saveResult.filePath, bytes);
      if (!writeResult?.success) {
        throw new Error(writeResult?.error || 'Could not write the file');
      }
      setExportStatus({ type: 'success', message: 'Map exported successfully!' });
    } catch (err) {
      setExportStatus({ type: 'error', message: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMarkdown = async () => {
    setIsExporting(true);
    setExportStatus(null);
    try {
      const result = await window.api.exportMarkdown(getFilterIds());
      if (!result.success) {
        throw new Error(result.error);
      }

      const saveResult = await window.api.saveFile({
        title: 'Export Workspace Report',
        defaultPath: 'airtable-workspace-report.md',
        filters: [{ name: 'Markdown Files', extensions: ['md'] }],
      });

      if (saveResult.canceled) {
        setExportStatus({ type: 'info', message: 'Export canceled' });
        return;
      }

      const writeResult = await window.api.writeFile(saveResult.filePath, result.data);
      if (!writeResult?.success) {
        throw new Error(writeResult?.error || 'Could not write the file');
      }
      setExportStatus({ type: 'success', message: 'Markdown report exported successfully!' });
    } catch (err) {
      setExportStatus({ type: 'error', message: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMermaid = async () => {
    setIsExporting(true);
    setExportStatus(null);
    try {
      const result = await window.api.exportMermaid(getFilterIds());
      if (!result.success) {
        throw new Error(result.error);
      }

      const saveResult = await window.api.saveFile({
        title: 'Export Mermaid Diagram',
        defaultPath: 'workspace-diagram.mmd',
        filters: [
          { name: 'Mermaid Files', extensions: ['mmd'] },
          { name: 'Text Files', extensions: ['txt'] },
        ],
      });

      if (saveResult.canceled) {
        setExportStatus({ type: 'info', message: 'Export canceled' });
        return;
      }

      const writeResult = await window.api.writeFile(saveResult.filePath, result.data);
      if (!writeResult?.success) {
        throw new Error(writeResult?.error || 'Could not write the file');
      }
      setExportStatus({ type: 'success', message: 'Mermaid diagram exported successfully!' });
    } catch (err) {
      setExportStatus({ type: 'error', message: err.message });
    } finally {
      setIsExporting(false);
    }
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  const hasFilteredBases = filteredBaseIds && filteredBaseIds.length > 0;
  const hasSelectedBase = !!selectedBaseId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-textPrimary">Export Data</h2>
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
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Status message */}
          {exportStatus && (
            <div
              className={`p-3 rounded-lg text-sm ${
                exportStatus.type === 'success'
                  ? 'bg-success/10 text-success border border-success/30'
                  : exportStatus.type === 'error'
                    ? 'bg-error/10 text-error border border-error/30'
                    : 'bg-surfaceLight text-textSecondary border border-border'
              }`}
            >
              {exportStatus.message}
            </div>
          )}

          {/* Filter scope */}
          <div className="bg-background rounded-lg p-4">
            <h3 className="text-sm font-medium text-textPrimary mb-3">Export Scope</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="filterScope"
                  value="all"
                  checked={filterScope === 'all'}
                  onChange={() => setFilterScope('all')}
                  className="accent-accent"
                />
                <span className="text-sm text-textSecondary">All bases</span>
              </label>
              <label
                className={`flex items-center gap-2 ${hasFilteredBases ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
              >
                <input
                  type="radio"
                  name="filterScope"
                  value="filtered"
                  checked={filterScope === 'filtered'}
                  onChange={() => setFilterScope('filtered')}
                  disabled={!hasFilteredBases}
                  className="accent-accent"
                />
                <span className="text-sm text-textSecondary">
                  Filtered bases{hasFilteredBases ? ` (${filteredBaseIds.length})` : ''}
                </span>
              </label>
              <label
                className={`flex items-center gap-2 ${hasSelectedBase ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
              >
                <input
                  type="radio"
                  name="filterScope"
                  value="selected"
                  checked={filterScope === 'selected'}
                  onChange={() => setFilterScope('selected')}
                  disabled={!hasSelectedBase}
                  className="accent-accent"
                />
                <span className="text-sm text-textSecondary">Selected base only</span>
              </label>
            </div>
          </div>

          {/* Export options */}
          <div className="space-y-3">
            {/* Workspace Map */}
            <div className="bg-background rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-textPrimary">Workspace Map</h3>
                  <p className="text-xs text-textMuted mt-1">
                    Export the current workspace visualization as a PNG image
                  </p>
                </div>
                <button
                  onClick={handleExportMap}
                  disabled={isExporting || !onExportMap}
                  className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-sm rounded disabled:opacity-50"
                >
                  {isExporting ? '...' : 'PNG'}
                </button>
              </div>
            </div>

            {/* Markdown Report */}
            <div className="bg-background rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-textPrimary">Workspace Report</h3>
                  <p className="text-xs text-textMuted mt-1">
                    Detailed Markdown report with bases, tables, fields, and relationships
                  </p>
                </div>
                <button
                  onClick={handleExportMarkdown}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-sm rounded disabled:opacity-50"
                >
                  {isExporting ? '...' : 'MD'}
                </button>
              </div>
            </div>

            {/* Mermaid Diagram */}
            <div className="bg-background rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-textPrimary">Relationship Diagram</h3>
                  <p className="text-xs text-textMuted mt-1">
                    Mermaid graph syntax for use in Notion, GitHub, or diagram tools
                  </p>
                </div>
                <button
                  onClick={handleExportMermaid}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-sm rounded disabled:opacity-50"
                >
                  {isExporting ? '...' : 'MMD'}
                </button>
              </div>
            </div>

            {/* Base Inventory CSV */}
            <div className="bg-background rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-textPrimary">Base Inventory</h3>
                  <p className="text-xs text-textMuted mt-1">
                    Export all bases with metadata as a spreadsheet
                  </p>
                </div>
                <button
                  onClick={handleExportCsv}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-sm rounded disabled:opacity-50"
                >
                  {isExporting ? '...' : 'CSV'}
                </button>
              </div>
            </div>

            {/* Full Backup JSON */}
            <div className="bg-background rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-textPrimary">Full Backup</h3>
                  <p className="text-xs text-textMuted mt-1">
                    Export all data including schemas and relationships
                  </p>
                </div>
                <button
                  onClick={handleExportJson}
                  disabled={isExporting}
                  className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white text-sm rounded disabled:opacity-50"
                >
                  {isExporting ? '...' : 'JSON'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
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

export default ExportModal;
