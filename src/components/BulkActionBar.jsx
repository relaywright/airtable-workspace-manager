import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { pluralize } from '../utils/format';

export function BulkActionBar({ selectedIds, onClearSelection, onExportSelected }) {
  const { bulkArchiveBases, bulkTagBases, allTags } = useAppContext();
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const count = selectedIds.length;
  if (count === 0) return null;

  const handleArchive = async () => {
    setIsProcessing(true);
    try {
      await bulkArchiveBases(selectedIds);
      onClearSelection();
    } finally {
      setIsProcessing(false);
      setShowArchiveConfirm(false);
    }
  };

  const handleApplyTag = async (tag) => {
    if (!tag.trim()) return;
    setIsProcessing(true);
    try {
      await bulkTagBases(selectedIds, [tag.trim()]);
    } finally {
      setIsProcessing(false);
      setNewTagInput('');
    }
  };

  return (
    <div className="absolute bottom-3 left-3 right-3 z-20">
      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <div className="mb-2 bg-surface border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm text-textPrimary mb-3">
            Archive {pluralize(count, 'base')}? This will hide them from the workspace map.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowArchiveConfirm(false)}
              disabled={isProcessing}
              className="px-3 py-1.5 text-sm text-textSecondary bg-surfaceLight hover:bg-border rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleArchive}
              disabled={isProcessing}
              className="px-3 py-1.5 text-sm text-white bg-warning hover:bg-warning/80 rounded transition-colors disabled:opacity-50"
            >
              {isProcessing ? 'Archiving...' : 'Archive'}
            </button>
          </div>
        </div>
      )}

      {/* Tag picker */}
      {showTagPicker && (
        <div className="mb-2 bg-surface border border-border rounded-lg p-3 shadow-lg">
          <p className="text-xs text-textMuted mb-2 uppercase tracking-wider">
            Add tag to {pluralize(count, 'base')}
          </p>
          {allTags.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleApplyTag(tag)}
                  disabled={isProcessing}
                  className="px-2 py-0.5 text-xs rounded-full bg-surfaceLight text-textSecondary hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApplyTag(newTagInput);
              }}
              placeholder="New tag name..."
              className="flex-1 px-2 py-1.5 bg-background border border-border rounded text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
              disabled={isProcessing}
            />
            <button
              onClick={() => handleApplyTag(newTagInput)}
              disabled={isProcessing || !newTagInput.trim()}
              className="px-3 py-1.5 text-sm text-white bg-accent hover:bg-accentHover rounded transition-colors disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowTagPicker(false);
                setNewTagInput('');
              }}
              className="px-3 py-1.5 text-sm text-textSecondary bg-surfaceLight hover:bg-border rounded transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main action bar */}
      <div className="bg-surface border border-border rounded-lg p-2 shadow-lg flex items-center gap-2">
        <span className="text-xs text-textMuted px-2 whitespace-nowrap">{count} selected</span>
        <div className="flex-1 flex gap-1.5 justify-end">
          {/* Tag Selected */}
          <button
            onClick={() => {
              setShowTagPicker(!showTagPicker);
              setShowArchiveConfirm(false);
            }}
            disabled={isProcessing}
            className="px-2.5 py-1.5 text-xs text-textSecondary bg-surfaceLight hover:bg-border rounded transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            Tag
          </button>
          {/* Archive Selected */}
          <button
            onClick={() => {
              setShowArchiveConfirm(!showArchiveConfirm);
              setShowTagPicker(false);
            }}
            disabled={isProcessing}
            className="px-2.5 py-1.5 text-xs text-warning bg-warning/10 hover:bg-warning/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            Archive
          </button>
          {/* Export Selected */}
          <button
            onClick={() => onExportSelected(selectedIds)}
            disabled={isProcessing}
            className="px-2.5 py-1.5 text-xs text-accent bg-accent/10 hover:bg-accent/20 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkActionBar;
