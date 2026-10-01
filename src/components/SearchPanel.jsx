import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { pluralize } from '../utils/format';
import { logger } from '../utils/logger';

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'tables', label: 'Tables' },
  { key: 'fields', label: 'Fields' },
  { key: 'linkedRecords', label: 'Linked Records' },
  { key: 'formulas', label: 'Formulas' },
];

export function SearchPanel({ isOpen, onClose }) {
  const { selectBase, bases } = useAppContext();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setFilter('all');
    }
  }, [isOpen]);

  const doSearch = useCallback(async (searchQuery, searchFilter) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const result = await window.api.searchSchemas(searchQuery.trim(), { filter: searchFilter });
      if (result.success) {
        setResults(result.data);
      }
    } catch (err) {
      logger.error('SearchPanel', 'Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search on query or filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, filter);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filter, doSearch]);

  const handleResultClick = (result) => {
    const base = bases.find((b) => b.id === result.baseId);
    if (base) {
      selectBase(base);
    }
    onClose();
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  // Group results by base
  const grouped = {};
  for (const r of results) {
    if (!grouped[r.baseId]) {
      grouped[r.baseId] = { baseName: r.baseName, baseId: r.baseId, items: [] };
    }
    grouped[r.baseId].items.push(r);
  }
  const groupedList = Object.values(grouped);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-20" onClick={onClose}>
      <div
        className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="p-4 border-b border-border">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-textMuted"
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
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search across all bases for tables, fields, or field types..."
              className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Filter chips */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === opt.key
                    ? 'bg-accent text-white'
                    : 'bg-surfaceLight text-textSecondary hover:bg-border'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2">
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-textMuted">Searching...</span>
            </div>
          )}

          {!isSearching && query.trim() && results.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-textMuted">No results found for "{query}"</span>
            </div>
          )}

          {!isSearching && !query.trim() && (
            <div className="flex items-center justify-center py-8">
              <span className="text-sm text-textMuted">
                Search across all bases for tables, fields, or field types
              </span>
            </div>
          )}

          {!isSearching &&
            groupedList.map((group) => (
              <div key={group.baseId} className="mb-3">
                <div className="px-3 py-1.5 text-xs font-semibold text-accent uppercase tracking-wide">
                  {group.baseName}
                </div>
                {group.items.map((item, idx) => (
                  <button
                    key={`${item.baseId}-${item.tableName}-${item.fieldName}-${idx}`}
                    onClick={() => handleResultClick(item)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-surfaceLight transition-colors flex items-center gap-3"
                  >
                    {/* Match type icon */}
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        item.matchType === 'table'
                          ? 'bg-accent'
                          : item.matchType === 'field'
                            ? 'bg-success'
                            : 'bg-warning'
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      {item.matchType === 'table' ? (
                        <span className="text-sm text-textPrimary">{item.tableName}</span>
                      ) : (
                        <span className="text-sm text-textPrimary">
                          <span className="text-textMuted">{item.tableName}</span>
                          <span className="text-textMuted mx-1">&rsaquo;</span>
                          {item.fieldName}
                        </span>
                      )}
                    </div>

                    <div className="shrink-0">
                      {item.matchType === 'table' ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent">table</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-surfaceLight text-textMuted">
                          {item.fieldType}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}

          {!isSearching && results.length > 0 && (
            <div className="px-3 py-2 text-xs text-textMuted border-t border-border mt-2">
              {pluralize(results.length, 'result')} across {pluralize(groupedList.length, 'base')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SearchPanel;
