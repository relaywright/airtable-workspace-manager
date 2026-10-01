import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { useEscapeKey } from '../hooks/useEscapeKey';

export function TagManager({ isOpen, onClose }) {
  const { allTags, renameTag, deleteTag } = useAppContext();
  const [editingTag, setEditingTag] = useState(null);
  const [newName, setNewName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleStartRename = (tag) => {
    setEditingTag(tag);
    setNewName(tag);
    setConfirmDelete(null);
  };

  const handleCancelRename = () => {
    setEditingTag(null);
    setNewName('');
  };

  const handleSaveRename = async () => {
    if (!editingTag || !newName.trim() || newName === editingTag) {
      handleCancelRename();
      return;
    }
    setIsLoading(true);
    try {
      await renameTag(editingTag, newName.trim());
      handleCancelRename();
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDelete = (tag) => {
    setConfirmDelete(tag);
    setEditingTag(null);
  };

  const handleCancelDelete = () => {
    setConfirmDelete(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setIsLoading(true);
    try {
      await deleteTag(confirmDelete);
      setConfirmDelete(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-textPrimary">Manage Tags</h2>
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
        <div className="p-4 max-h-96 overflow-y-auto">
          {allTags.length === 0 ? (
            <p className="text-center text-textMuted py-8">
              No tags created yet. Add tags to bases from the detail panel.
            </p>
          ) : (
            <div className="space-y-2">
              {allTags.map((tag) => (
                <div key={tag} className="bg-background rounded-lg p-3">
                  {editingTag === tag ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename();
                          if (e.key === 'Escape') {
                            // Cancel the rename only; keep the Tag Manager open
                            e.preventDefault();
                            handleCancelRename();
                          }
                        }}
                        className="flex-1 px-2 py-1 bg-surface border border-border rounded text-sm text-textPrimary"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveRename}
                        disabled={isLoading}
                        className="px-2 py-1 bg-accent hover:bg-accentHover text-white text-xs rounded disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelRename}
                        className="px-2 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-xs rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : confirmDelete === tag ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-error">Delete "{tag}"?</span>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDelete}
                          disabled={isLoading}
                          className="px-2 py-1 bg-error hover:bg-error/80 text-white text-xs rounded disabled:opacity-50"
                        >
                          {isLoading ? 'Deleting...' : 'Delete'}
                        </button>
                        <button
                          onClick={handleCancelDelete}
                          className="px-2 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-xs rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-textPrimary">{tag}</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStartRename(tag)}
                          className="text-xs text-accent hover:text-accentHover"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleConfirmDelete(tag)}
                          className="text-xs text-error hover:text-error/80"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default TagManager;
