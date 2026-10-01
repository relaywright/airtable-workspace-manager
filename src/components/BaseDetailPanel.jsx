import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { BaseThumbnail } from './BaseThumbnail';
import { ImpactPanel } from './ImpactPanel';
import { PermissionBadge } from './PermissionBadge';
import { getPermissionInfo } from '../utils/permissions';
import { pluralize } from '../utils/format';

export function BaseDetailPanel({ onViewSchema, onViewHistory }) {
  const {
    selectedBase,
    relationships,
    clearSelection,
    updateBaseDescription,
    updateRelationship,
    updateBaseTags,
    allTags,
    bases,
    archiveBase,
    unarchiveBase,
    selectBase,
  } = useAppContext();

  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingRelationshipId, setEditingRelationshipId] = useState(null);
  const [relationshipEdits, setRelationshipEdits] = useState({ notes: '', status: 'unverified' });
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [archiveWarning, setArchiveWarning] = useState(null);
  const tagMenuRef = useRef(null);

  const closeTagDropdown = useCallback(() => {
    setShowTagDropdown(false);
    setNewTagInput('');
  }, []);
  useOutsideClick(tagMenuRef, closeTagDropdown, showTagDropdown);
  useEscapeKey(closeTagDropdown, showTagDropdown);

  // A dropdown left open must never add a tag to a different base.
  useEffect(() => {
    closeTagDropdown();
  }, [selectedBase?.id, closeTagDropdown]);

  // Parse schema if available
  const schema = useMemo(() => {
    if (!selectedBase?.schemaJson) return null;
    try {
      return JSON.parse(selectedBase.schemaJson);
    } catch {
      return null;
    }
  }, [selectedBase?.schemaJson]);

  // Parse tags for this base
  const baseTags = useMemo(() => {
    if (!selectedBase?.userTags) return [];
    try {
      const tags = JSON.parse(selectedBase.userTags);
      return Array.isArray(tags) ? tags : [];
    } catch {
      return [];
    }
  }, [selectedBase?.userTags]);

  // Get connections
  const { incoming, outgoing } = useMemo(() => {
    if (!selectedBase) return { incoming: [], outgoing: [] };

    const incoming = relationships.filter((r) => r.targetBaseId === selectedBase.id);
    const outgoing = relationships.filter((r) => r.sourceBaseId === selectedBase.id);

    return { incoming, outgoing };
  }, [selectedBase, relationships]);

  // Get base name by ID
  const getBaseName = (baseId) => {
    const base = bases.find((b) => b.id === baseId);
    return base?.name || baseId;
  };

  const handleStartEdit = () => {
    setDescription(selectedBase.userDescription || '');
    setIsEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    setIsSaving(true);
    try {
      await updateBaseDescription(selectedBase.id, description);
      setIsEditingDescription(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingDescription(false);
    setDescription('');
  };

  const handleOpenInAirtable = () => {
    const url = `https://airtable.com/${selectedBase.id}`;
    window.open(url, '_blank');
  };

  const handleStartEditRelationship = (rel) => {
    setEditingRelationshipId(rel.id);
    setRelationshipEdits({
      notes: rel.notes || '',
      status: rel.status || 'unverified',
    });
  };

  const handleSaveRelationship = async () => {
    if (!editingRelationshipId) return;
    setIsSaving(true);
    try {
      await updateRelationship(editingRelationshipId, relationshipEdits);
      setEditingRelationshipId(null);
      setRelationshipEdits({ notes: '', status: 'unverified' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEditRelationship = () => {
    setEditingRelationshipId(null);
    setRelationshipEdits({ notes: '', status: 'unverified' });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'verified':
        return 'bg-success/20 text-success';
      case 'invalid':
        return 'bg-error/20 text-error';
      default:
        return 'bg-warning/20 text-warning';
    }
  };

  // Relationship type badge styling
  const getTypeBadge = (type) => {
    switch (type) {
      case 'sync':
        return { label: 'Sync', classes: 'bg-success/20 text-success' };
      case 'link':
        return { label: 'Link', classes: 'bg-accent/20 text-accent' };
      case 'structural':
        return { label: 'Structural', classes: 'bg-warning/20 text-warning' };
      default:
        return { label: type || 'Unknown', classes: 'bg-surfaceLight text-textMuted' };
    }
  };

  // Format detection reason for display
  const formatDetectionReason = (reason) => {
    if (!reason) return null;
    if (reason === 'sync_metadata') return 'Detected via sync metadata';
    if (reason === 'cross_base_link') return 'Cross-base linked record field';
    if (reason.startsWith('structural_match:')) {
      const pct = reason.split(':')[1];
      return `Field similarity: ${pct}`;
    }
    return reason;
  };

  const isReadOnly = selectedBase?.permissionLevel === 'read' || selectedBase?.permissionLevel === 'comment';

  const handleAddTag = async (tag) => {
    if (!tag || baseTags.includes(tag)) return;
    const newTags = [...baseTags, tag];
    await updateBaseTags(selectedBase.id, newTags);
    setShowTagDropdown(false);
    setNewTagInput('');
  };

  const handleRemoveTag = async (tagToRemove) => {
    const newTags = baseTags.filter((t) => t !== tagToRemove);
    await updateBaseTags(selectedBase.id, newTags);
  };

  const handleCreateAndAddTag = async () => {
    const tag = newTagInput.trim();
    if (tag) {
      await handleAddTag(tag);
    }
  };

  // Filter available tags (tags not already on this base)
  const availableTags = allTags.filter((t) => !baseTags.includes(t));

  // Archive with impact check
  const handleArchiveWithCheck = async () => {
    if (selectedBase.isArchived) {
      unarchiveBase(selectedBase.id);
      return;
    }
    try {
      const result = await window.api.getImpactReport(selectedBase.id);
      if (result.success && result.data && result.data.downstream.length >= 3) {
        setArchiveWarning(result.data);
      } else {
        archiveBase(selectedBase.id);
      }
    } catch {
      // If impact check fails, proceed with archive anyway
      archiveBase(selectedBase.id);
    }
  };

  const confirmArchive = () => {
    archiveBase(selectedBase.id);
    setArchiveWarning(null);
  };

  const cancelArchive = () => {
    setArchiveWarning(null);
  };

  if (!selectedBase) return null;

  return (
    <aside className="w-80 bg-surface border-l border-border flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <BaseThumbnail baseId={selectedBase.id} baseName={selectedBase.name} size="medium" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-textPrimary truncate" title={selectedBase.name}>
                {selectedBase.name}
              </h2>
              <div className="mt-0.5 flex items-center">
                {getPermissionInfo(selectedBase.permissionLevel) ? (
                  <PermissionBadge level={selectedBase.permissionLevel} />
                ) : (
                  <span className="text-xs text-textMuted">Access level unknown</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={clearSelection}
          className="p-1 rounded hover:bg-surfaceLight transition-colors shrink-0"
          aria-label="Close panel"
        >
          <svg className="w-5 h-5 text-textMuted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Stats */}
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-3">Overview</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background rounded-lg p-3">
              <div className="text-2xl font-semibold text-textPrimary">{selectedBase.tableCount || 0}</div>
              <div className="text-xs text-textMuted">Tables</div>
            </div>
            <div className="bg-background rounded-lg p-3">
              <div className="text-2xl font-semibold text-textPrimary">{selectedBase.fieldCount || 0}</div>
              <div className="text-xs text-textMuted">Fields</div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider">Description</h3>
            {!isEditingDescription &&
              (isReadOnly ? (
                <span className="text-xs text-textMuted cursor-not-allowed" title="Edit access required">
                  Edit
                </span>
              ) : (
                <button onClick={handleStartEdit} className="text-xs text-accent hover:text-accentHover">
                  Edit
                </button>
              ))}
          </div>
          {isEditingDescription ? (
            <div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                className="w-full h-24 px-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted resize-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSaveDescription}
                  disabled={isSaving}
                  className="px-3 py-1 bg-accent hover:bg-accentHover text-white text-sm rounded-lg disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-sm rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-textSecondary">
              {selectedBase.userDescription || 'No description added.'}
            </p>
          )}
        </div>

        {/* Tags */}
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-2">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {baseTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 bg-accent/20 text-accent text-xs rounded-full"
              >
                {tag}
                <button
                  onClick={() => !isReadOnly && handleRemoveTag(tag)}
                  className={isReadOnly ? 'cursor-not-allowed opacity-50' : 'hover:text-error'}
                  aria-label={isReadOnly ? 'Edit access required' : `Remove tag ${tag}`}
                  title={isReadOnly ? 'Edit access required' : undefined}
                  disabled={isReadOnly}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </span>
            ))}
            <div className="relative" ref={tagMenuRef}>
              {isReadOnly ? (
                <span
                  className="px-2 py-1 bg-surfaceLight text-textMuted text-xs rounded-full cursor-not-allowed opacity-50"
                  title="Edit access required"
                >
                  + Add Tag
                </span>
              ) : (
                <button
                  onClick={() => setShowTagDropdown(!showTagDropdown)}
                  className="px-2 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-xs rounded-full transition-colors"
                >
                  + Add Tag
                </button>
              )}
              {showTagDropdown && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg z-10">
                  <div className="p-2 border-b border-border">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateAndAddTag()}
                      placeholder="New tag name..."
                      className="w-full px-2 py-1 bg-background border border-border rounded text-sm text-textPrimary placeholder-textMuted"
                      autoFocus
                    />
                    {newTagInput.trim() && (
                      <button
                        onClick={handleCreateAndAddTag}
                        className="w-full mt-1 px-2 py-1 bg-accent hover:bg-accentHover text-white text-xs rounded"
                      >
                        Create "{newTagInput.trim()}"
                      </button>
                    )}
                  </div>
                  {availableTags.length > 0 && (
                    <div className="max-h-32 overflow-y-auto">
                      {availableTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => handleAddTag(tag)}
                          className="w-full px-3 py-2 text-left text-sm text-textSecondary hover:bg-surfaceLight"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                  {availableTags.length === 0 && !newTagInput.trim() && (
                    <div className="p-3 text-xs text-textMuted">No existing tags. Type to create one.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tables */}
        {schema?.tables && schema.tables.length > 0 && (
          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-3">
              Tables ({schema.tables.length})
            </h3>
            <div className="space-y-2">
              {schema.tables.map((table) => (
                <div key={table.id} className="bg-background rounded-lg px-3 py-2">
                  <div className="text-sm text-textPrimary">{table.name}</div>
                  <div className="text-xs text-textMuted">
                    {pluralize(table.fields?.length || 0, 'field')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connections */}
        <div className="p-4 border-b border-border">
          <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-3">
            Connections ({incoming.length + outgoing.length})
          </h3>

          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className="text-sm text-textMuted">No connections detected.</p>
          ) : (
            <div className="space-y-3">
              {outgoing.length > 0 && (
                <div>
                  <div className="text-xs text-textMuted mb-2">Outgoing ({outgoing.length})</div>
                  <div className="space-y-2">
                    {outgoing.map((rel) => (
                      <div key={rel.id} className="bg-background rounded-lg px-3 py-2">
                        {editingRelationshipId === rel.id ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <svg
                                className="w-4 h-4 text-success shrink-0"
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
                              <span className="text-sm text-textPrimary truncate">
                                {getBaseName(rel.targetBaseId)}
                              </span>
                            </div>
                            <select
                              value={relationshipEdits.status}
                              onChange={(e) =>
                                setRelationshipEdits((prev) => ({ ...prev, status: e.target.value }))
                              }
                              className="w-full px-2 py-1 bg-surface border border-border rounded text-sm text-textPrimary"
                            >
                              <option value="unverified">Unverified</option>
                              <option value="verified">Verified</option>
                              <option value="invalid">Invalid</option>
                            </select>
                            <textarea
                              value={relationshipEdits.notes}
                              onChange={(e) =>
                                setRelationshipEdits((prev) => ({ ...prev, notes: e.target.value }))
                              }
                              placeholder="Add notes about this relationship..."
                              className="w-full h-16 px-2 py-1 bg-surface border border-border rounded text-sm text-textPrimary placeholder-textMuted resize-none"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveRelationship}
                                disabled={isSaving}
                                className="px-2 py-1 bg-accent hover:bg-accentHover text-white text-xs rounded disabled:opacity-50"
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={handleCancelEditRelationship}
                                className="px-2 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-xs rounded"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2">
                              <svg
                                className="w-4 h-4 text-success shrink-0"
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
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm text-textPrimary truncate">
                                    {getBaseName(rel.targetBaseId)}
                                  </span>
                                  <span
                                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${getTypeBadge(rel.type).classes}`}
                                  >
                                    {getTypeBadge(rel.type).label}
                                  </span>
                                </div>
                                <div className="text-xs text-textMuted">
                                  {rel.sourceTableName} → {rel.targetTableName}
                                </div>
                                {formatDetectionReason(rel.detectionReason) && (
                                  <div className="text-[10px] text-textMuted/70 mt-0.5">
                                    {formatDetectionReason(rel.detectionReason)}
                                  </div>
                                )}
                              </div>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(rel.status)}`}>
                                {rel.status || 'unverified'}
                              </span>
                              <button
                                onClick={() => handleStartEditRelationship(rel)}
                                className="text-xs text-accent hover:text-accentHover"
                              >
                                Edit
                              </button>
                            </div>
                            {rel.notes && <p className="text-xs text-textMuted mt-1 ml-6">{rel.notes}</p>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {incoming.length > 0 && (
                <div>
                  <div className="text-xs text-textMuted mb-2">Incoming ({incoming.length})</div>
                  <div className="space-y-2">
                    {incoming.map((rel) => (
                      <div key={rel.id} className="bg-background rounded-lg px-3 py-2">
                        {editingRelationshipId === rel.id ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <svg
                                className="w-4 h-4 text-accent shrink-0"
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
                              <span className="text-sm text-textPrimary truncate">
                                {getBaseName(rel.sourceBaseId)}
                              </span>
                            </div>
                            <select
                              value={relationshipEdits.status}
                              onChange={(e) =>
                                setRelationshipEdits((prev) => ({ ...prev, status: e.target.value }))
                              }
                              className="w-full px-2 py-1 bg-surface border border-border rounded text-sm text-textPrimary"
                            >
                              <option value="unverified">Unverified</option>
                              <option value="verified">Verified</option>
                              <option value="invalid">Invalid</option>
                            </select>
                            <textarea
                              value={relationshipEdits.notes}
                              onChange={(e) =>
                                setRelationshipEdits((prev) => ({ ...prev, notes: e.target.value }))
                              }
                              placeholder="Add notes about this relationship..."
                              className="w-full h-16 px-2 py-1 bg-surface border border-border rounded text-sm text-textPrimary placeholder-textMuted resize-none"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveRelationship}
                                disabled={isSaving}
                                className="px-2 py-1 bg-accent hover:bg-accentHover text-white text-xs rounded disabled:opacity-50"
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={handleCancelEditRelationship}
                                className="px-2 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-xs rounded"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2">
                              <svg
                                className="w-4 h-4 text-accent shrink-0"
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
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm text-textPrimary truncate">
                                    {getBaseName(rel.sourceBaseId)}
                                  </span>
                                  <span
                                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${getTypeBadge(rel.type).classes}`}
                                  >
                                    {getTypeBadge(rel.type).label}
                                  </span>
                                </div>
                                <div className="text-xs text-textMuted">
                                  {rel.sourceTableName} → {rel.targetTableName}
                                </div>
                                {formatDetectionReason(rel.detectionReason) && (
                                  <div className="text-[10px] text-textMuted/70 mt-0.5">
                                    {formatDetectionReason(rel.detectionReason)}
                                  </div>
                                )}
                              </div>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusColor(rel.status)}`}>
                                {rel.status || 'unverified'}
                              </span>
                              <button
                                onClick={() => handleStartEditRelationship(rel)}
                                className="text-xs text-accent hover:text-accentHover"
                              >
                                Edit
                              </button>
                            </div>
                            {rel.notes && <p className="text-xs text-textMuted mt-1 ml-6">{rel.notes}</p>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Impact Analysis */}
        <ImpactPanel
          selectedBase={selectedBase}
          relationships={relationships}
          bases={bases}
          onSelectBase={selectBase}
        />
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <button
          onClick={() => onViewSchema?.(selectedBase)}
          className="w-full px-4 py-2 bg-accent hover:bg-accentHover text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
          View Schema Map
        </button>
        <button
          onClick={() => onViewHistory?.(selectedBase)}
          className="w-full px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          View History
        </button>
        <button
          onClick={handleOpenInAirtable}
          className="w-full px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
          Open in Airtable
        </button>
        <button
          onClick={handleArchiveWithCheck}
          className={`w-full px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
            selectedBase.isArchived
              ? 'bg-success/20 hover:bg-success/30 text-success'
              : 'bg-warning/20 hover:bg-warning/30 text-warning'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
            />
          </svg>
          {selectedBase.isArchived ? 'Unarchive Base' : 'Archive Base'}
        </button>

        {/* Archive impact warning */}
        {archiveWarning && (
          <div className="bg-error/10 border border-error/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
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
              <span className="text-xs font-medium text-error">
                This base has {pluralize(archiveWarning.downstream.length, 'dependent base')}
              </span>
            </div>
            <div className="text-xs text-error/80">
              Archiving may affect: {archiveWarning.downstream.map((d) => d.name).join(', ')}
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmArchive}
                className="px-3 py-1 bg-error/20 hover:bg-error/30 text-error text-xs rounded"
              >
                Archive Anyway
              </button>
              <button
                onClick={cancelArchive}
                className="px-3 py-1 bg-surfaceLight hover:bg-border text-textSecondary text-xs rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export default BaseDetailPanel;
