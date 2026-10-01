import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { BaseThumbnail } from './BaseThumbnail';
import { BulkActionBar } from './BulkActionBar';
import { PermissionBadge } from './PermissionBadge';
import { pluralize } from '../utils/format';
import { getConnectionCounts } from '../utils/relationships';

export function Sidebar({
  onViewSchema,
  onManageTags,
  onOpenChangeLog,
  onOpenBackups,
  onFilteredBasesChange,
  onExportSelected,
}) {
  const {
    bases,
    selectedBase,
    selectBase,
    relationships,
    allTags,
    showArchived,
    toggleShowArchived,
    namingConvention,
  } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterConventionOnly, setFilterConventionOnly] = useState(false);
  const [filterConnectedOnly, setFilterConnectedOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const connectionCounts = useMemo(() => getConnectionCounts(relationships), [relationships]);

  // Helper to parse base tags
  const getBaseTags = (base) => {
    if (!base.userTags) return [];
    try {
      const tags = JSON.parse(base.userTags);
      return Array.isArray(tags) ? tags : [];
    } catch {
      return [];
    }
  };

  // Toggle tag selection
  const toggleTag = (tag) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  // Filter bases based on search and filters
  const filteredBases = useMemo(() => {
    return bases.filter((base) => {
      // Archived filter
      if (!showArchived && base.isArchived) {
        return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!base.name.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Naming convention filter
      if (filterConventionOnly && !base.matchesConvention) {
        return false;
      }

      // Connected filter
      if (filterConnectedOnly && !connectionCounts[base.id]) {
        return false;
      }

      // Tag filter
      if (selectedTags.length > 0) {
        const baseTags = getBaseTags(base);
        if (!selectedTags.some((tag) => baseTags.includes(tag))) {
          return false;
        }
      }

      return true;
    });
  }, [
    bases,
    searchQuery,
    filterConventionOnly,
    filterConnectedOnly,
    connectionCounts,
    selectedTags,
    showArchived,
  ]);

  // Notify parent of filtered base IDs for export filtering
  useEffect(() => {
    if (onFilteredBasesChange) {
      onFilteredBasesChange(filteredBases.map((b) => b.id));
    }
  }, [filteredBases, onFilteredBasesChange]);

  // Clean up selectedIds when leaving select mode or when bases change
  useEffect(() => {
    if (!selectMode) {
      setSelectedIds([]);
    }
  }, [selectMode]);

  // Remove selectedIds that are no longer in filteredBases
  useEffect(() => {
    const visibleIds = new Set(filteredBases.map((b) => b.id));
    setSelectedIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [filteredBases]);

  const toggleSelectId = useCallback((baseId) => {
    setSelectedIds((prev) =>
      prev.includes(baseId) ? prev.filter((id) => id !== baseId) : [...prev, baseId],
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(filteredBases.map((b) => b.id));
  }, [filteredBases]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleExportSelected = useCallback(
    (ids) => {
      if (onExportSelected) {
        onExportSelected(ids);
      }
    },
    [onExportSelected],
  );

  // Count archived bases
  const archivedCount = useMemo(() => bases.filter((b) => b.isArchived).length, [bases]);

  return (
    <aside className="w-64 bg-surface border-r border-border flex flex-col shrink-0 relative">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search bases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="p-3 border-b border-border flex gap-2 flex-wrap">
        {namingConvention?.enabled && (
          <button
            onClick={() => setFilterConventionOnly(!filterConventionOnly)}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filterConventionOnly
                ? 'bg-accent text-white'
                : 'bg-surfaceLight text-textSecondary hover:bg-border'
            }`}
          >
            {namingConvention.label} only
          </button>
        )}
        <button
          onClick={() => setFilterConnectedOnly(!filterConnectedOnly)}
          className={`px-2 py-1 text-xs rounded-full transition-colors ${
            filterConnectedOnly
              ? 'bg-accent text-white'
              : 'bg-surfaceLight text-textSecondary hover:bg-border'
          }`}
        >
          Connected
        </button>
        {archivedCount > 0 && (
          <button
            onClick={toggleShowArchived}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              showArchived
                ? 'bg-warning/20 text-warning'
                : 'bg-surfaceLight text-textSecondary hover:bg-border'
            }`}
          >
            Archived ({archivedCount})
          </button>
        )}
        <button
          onClick={() => setSelectMode(!selectMode)}
          className={`px-2 py-1 text-xs rounded-full transition-colors ${
            selectMode ? 'bg-accent text-white' : 'bg-surfaceLight text-textSecondary hover:bg-border'
          }`}
        >
          Select
        </button>
      </div>

      {/* Quick Actions */}
      <div className="p-3 border-b border-border space-y-2">
        <button
          onClick={onOpenChangeLog}
          className="w-full flex items-center gap-2 px-3 py-2 bg-surfaceLight hover:bg-border rounded-lg text-sm text-textSecondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Change Log
        </button>
        {onOpenBackups && (
          <button
            onClick={onOpenBackups}
            className="w-full flex items-center gap-2 px-3 py-2 bg-surfaceLight hover:bg-border rounded-lg text-sm text-textSecondary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            Backups
            <span
              aria-hidden="true"
              className="ml-auto px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-accent/15 text-accent"
            >
              Preview
            </span>
          </button>
        )}
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-textMuted uppercase tracking-wider">Tags</span>
            {onManageTags && (
              <button onClick={onManageTags} className="text-xs text-accent hover:text-accentHover">
                Manage
              </button>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                  selectedTags.includes(tag)
                    ? 'bg-accent text-white'
                    : 'bg-surfaceLight text-textSecondary hover:bg-border'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              className="mt-2 text-xs text-textMuted hover:text-textSecondary"
            >
              Clear tag filter
            </button>
          )}
        </div>
      )}

      {/* Base count and select-mode controls */}
      <div className="px-3 py-2 text-xs text-textMuted flex items-center justify-between">
        <span>
          {filteredBases.length} of {pluralize(bases.length, 'base')}
        </span>
        {selectMode && (
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-accent hover:text-accentHover">
              All
            </button>
            <button onClick={clearSelection} className="text-textMuted hover:text-textSecondary">
              None
            </button>
          </div>
        )}
      </div>

      {/* Base list */}
      <div className={`flex-1 overflow-y-auto ${selectedIds.length > 0 ? 'pb-16' : ''}`}>
        {filteredBases.map((base) => (
          <div
            key={base.id}
            className={`group w-full px-3 py-2 flex items-center gap-2 transition-colors ${
              selectedBase?.id === base.id
                ? 'bg-accent/20 border-l-2 border-accent'
                : 'hover:bg-surfaceLight border-l-2 border-transparent'
            }`}
          >
            {selectMode && (
              <input
                type="checkbox"
                checked={selectedIds.includes(base.id)}
                onChange={() => toggleSelectId(base.id)}
                className="shrink-0 accent-accent w-3.5 h-3.5 cursor-pointer"
              />
            )}
            <button
              onClick={() => (selectMode ? toggleSelectId(base.id) : selectBase(base))}
              onDoubleClick={() => !selectMode && onViewSchema?.(base)}
              className={`flex-1 flex items-center gap-2 text-left min-w-0 ${base.isArchived ? 'opacity-50' : ''}`}
            >
              <BaseThumbnail baseId={base.id} baseName={base.name} size="small" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-textPrimary flex items-center gap-1 min-w-0">
                  <span className="truncate">{base.name}</span>
                  <PermissionBadge level={base.permissionLevel} className="text-[9px] px-1 py-0.5" />
                  {Boolean(base.isArchived) && (
                    <span className="text-[10px] px-1 py-0.5 bg-warning/20 text-warning rounded shrink-0">
                      archived
                    </span>
                  )}
                </div>
                <div className="text-xs text-textMuted">
                  {pluralize(base.tableCount || 0, 'table')}
                  {connectionCounts[base.id] > 0 && (
                    <span className="ml-2">{pluralize(connectionCounts[base.id], 'connection')}</span>
                  )}
                </div>
              </div>
            </button>
            {!selectMode && (
              <button
                onClick={() => onViewSchema?.(base)}
                className="p-1 rounded hover:bg-border transition-colors opacity-0 group-hover:opacity-100"
                title="View schema map"
                aria-label={`View schema map for ${base.name}`}
              >
                <svg
                  className="w-4 h-4 text-textMuted hover:text-accent"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}

        {filteredBases.length === 0 && (
          <div className="p-4 text-center text-textMuted text-sm">No bases found</div>
        )}
      </div>

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedIds={selectedIds}
        onClearSelection={() => {
          clearSelection();
          setSelectMode(false);
        }}
        onExportSelected={handleExportSelected}
      />
    </aside>
  );
}

export default Sidebar;
