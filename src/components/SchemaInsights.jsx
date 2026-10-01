import React, { useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { parseTimestamp } from '../utils/format';

function SchemaInsights({ isOpen, onClose }) {
  const { selectedBase } = useAppContext();
  const [activeTab, setActiveTab] = useState('base');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Base analysis state
  const [baseAnalysis, setBaseAnalysis] = useState(null);
  const [baseDocs, setBaseDocs] = useState(null);

  // Workspace analysis state
  const [workspaceAnalysis, setWorkspaceAnalysis] = useState(null);

  const handleAnalyzeBase = useCallback(async () => {
    if (!selectedBase) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.api.analyzeBase(selectedBase.id);
      if (result.success) {
        setBaseAnalysis(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBase]);

  const handleGenerateDocs = useCallback(async () => {
    if (!selectedBase) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.api.generateDocumentation(selectedBase.id);
      if (result.success) {
        setBaseDocs(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBase]);

  const handleAnalyzeWorkspace = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.api.analyzeWorkspace();
      if (result.success) {
        setWorkspaceAnalysis(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const formatCacheTime = (timestamp) => {
    if (!timestamp) return '';
    const date = parseTimestamp(timestamp);
    return date ? date.toLocaleString() : '';
  };

  const getHealthColor = (score) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const getHealthBgColor = (score) => {
    if (score >= 80) return 'bg-green-500/10 border-green-500/30';
    if (score >= 60) return 'bg-yellow-500/10 border-yellow-500/30';
    if (score >= 40) return 'bg-orange-500/10 border-orange-500/30';
    return 'bg-red-500/10 border-red-500/30';
  };

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-600/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-textPrimary">Schema Insights</h2>
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

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setActiveTab('base')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'base'
                ? 'text-accent border-b-2 border-accent'
                : 'text-textMuted hover:text-textSecondary'
            }`}
          >
            Base Analysis
          </button>
          <button
            onClick={() => setActiveTab('workspace')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'workspace'
                ? 'text-accent border-b-2 border-accent'
                : 'text-textMuted hover:text-textSecondary'
            }`}
          >
            Workspace Health
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Error display */}
          {error && (
            <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Loading spinner */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm text-textMuted">Analyzing schema...</p>
              <p className="text-xs text-textMuted mt-1">This may take a moment</p>
            </div>
          )}

          {/* Base Analysis Tab */}
          {activeTab === 'base' && !isLoading && (
            <div className="space-y-4">
              {!selectedBase ? (
                <div className="text-center py-8">
                  <p className="text-textMuted">Select a base from the sidebar or map to analyze it.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-textPrimary">{selectedBase.name}</h3>
                      {baseAnalysis?.cachedAt && (
                        <p className="text-xs text-textMuted mt-0.5">
                          Last analyzed: {formatCacheTime(baseAnalysis.cachedAt)}
                          {baseAnalysis.fromCache && ' (cached)'}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAnalyzeBase()}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        Analyze
                      </button>
                      <button
                        onClick={handleGenerateDocs}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        Generate Docs
                      </button>
                    </div>
                  </div>

                  {baseAnalysis && (
                    <div className="space-y-4">
                      {/* Summary */}
                      {baseAnalysis.summary && (
                        <div className="p-3 bg-background rounded-lg">
                          <h4 className="text-xs font-medium text-textPrimary mb-1.5">Summary</h4>
                          <p className="text-sm text-textSecondary">{baseAnalysis.summary}</p>
                        </div>
                      )}

                      {/* Anti-patterns */}
                      {baseAnalysis.antiPatterns?.length > 0 && (
                        <div className="p-3 bg-background rounded-lg">
                          <h4 className="text-xs font-medium text-textPrimary mb-1.5">
                            Anti-Patterns Detected
                          </h4>
                          <ul className="space-y-1">
                            {baseAnalysis.antiPatterns.map((pattern, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-textSecondary">
                                <span className="text-orange-400 mt-0.5 shrink-0">!</span>
                                <span>{pattern}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Suggestions */}
                      {baseAnalysis.suggestions?.length > 0 && (
                        <div className="p-3 bg-background rounded-lg">
                          <h4 className="text-xs font-medium text-textPrimary mb-1.5">Suggestions</h4>
                          <ul className="space-y-1">
                            {baseAnalysis.suggestions.map((suggestion, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-textSecondary">
                                <span className="text-green-400 mt-0.5 shrink-0">+</span>
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Field Purposes */}
                      {baseAnalysis.fieldPurposes && Object.keys(baseAnalysis.fieldPurposes).length > 0 && (
                        <div className="p-3 bg-background rounded-lg">
                          <h4 className="text-xs font-medium text-textPrimary mb-1.5">Field Purposes</h4>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {Object.entries(baseAnalysis.fieldPurposes).map(([field, purpose]) => (
                              <div key={field} className="flex gap-2 text-sm">
                                <span className="text-accent font-mono text-xs shrink-0">{field}</span>
                                <span className="text-textMuted">-</span>
                                <span className="text-textSecondary">{purpose}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Documentation output */}
                  {baseDocs && (
                    <div className="p-3 bg-background rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-medium text-textPrimary">Generated Documentation</h4>
                        {baseDocs.cachedAt && (
                          <span className="text-[10px] text-textMuted">
                            {baseDocs.fromCache ? 'Cached' : 'Fresh'} - {formatCacheTime(baseDocs.cachedAt)}
                          </span>
                        )}
                      </div>
                      <pre className="text-sm text-textSecondary whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                        {baseDocs.markdown}
                      </pre>
                    </div>
                  )}

                  {!baseAnalysis && !baseDocs && (
                    <div className="text-center py-6">
                      <p className="text-sm text-textMuted">
                        Click "Analyze" to have Claude review this base's schema and suggest improvements.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Workspace Health Tab */}
          {activeTab === 'workspace' && !isLoading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-textPrimary">Workspace Health Check</h3>
                  {workspaceAnalysis?.cachedAt && (
                    <p className="text-xs text-textMuted mt-0.5">
                      Last checked: {formatCacheTime(workspaceAnalysis.cachedAt)}
                      {workspaceAnalysis.fromCache && ' (cached)'}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleAnalyzeWorkspace}
                  disabled={isLoading}
                  className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  Run Health Check
                </button>
              </div>

              {workspaceAnalysis && (
                <div className="space-y-4">
                  {/* Health Score */}
                  <div className={`p-4 rounded-lg border ${getHealthBgColor(workspaceAnalysis.healthScore)}`}>
                    <div className="flex items-center gap-4">
                      <div className={`text-4xl font-bold ${getHealthColor(workspaceAnalysis.healthScore)}`}>
                        {workspaceAnalysis.healthScore}
                      </div>
                      <div>
                        <div
                          className={`text-sm font-medium ${getHealthColor(workspaceAnalysis.healthScore)}`}
                        >
                          {workspaceAnalysis.healthLabel || 'Health Score'}
                        </div>
                        <div className="text-xs text-textMuted mt-0.5">out of 100</div>
                      </div>
                    </div>
                  </div>

                  {/* Top Issues */}
                  {workspaceAnalysis.topIssues?.length > 0 && (
                    <div className="p-3 bg-background rounded-lg">
                      <h4 className="text-xs font-medium text-textPrimary mb-1.5">Top Issues</h4>
                      <ul className="space-y-1.5">
                        {workspaceAnalysis.topIssues.map((issue, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-textSecondary">
                            <span className="text-red-400 mt-0.5 shrink-0">{i + 1}.</span>
                            <span>{issue}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Relationship Quality */}
                  {workspaceAnalysis.relationshipQuality && (
                    <div className="p-3 bg-background rounded-lg">
                      <h4 className="text-xs font-medium text-textPrimary mb-1.5">Relationship Quality</h4>
                      <p className="text-sm text-textSecondary">{workspaceAnalysis.relationshipQuality}</p>
                    </div>
                  )}

                  {/* Redundancies */}
                  {workspaceAnalysis.redundancies?.length > 0 && (
                    <div className="p-3 bg-background rounded-lg">
                      <h4 className="text-xs font-medium text-textPrimary mb-1.5">Redundancy Warnings</h4>
                      <ul className="space-y-1">
                        {workspaceAnalysis.redundancies.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-textSecondary">
                            <span className="text-yellow-400 mt-0.5 shrink-0">~</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommendations */}
                  {workspaceAnalysis.recommendations?.length > 0 && (
                    <div className="p-3 bg-background rounded-lg">
                      <h4 className="text-xs font-medium text-textPrimary mb-1.5">Recommendations</h4>
                      <ul className="space-y-1.5">
                        {workspaceAnalysis.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-textSecondary">
                            <span className="text-accent mt-0.5 shrink-0">*</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!workspaceAnalysis && (
                <div className="text-center py-6">
                  <p className="text-sm text-textMuted">
                    Click "Run Health Check" to have Claude review the structure of your whole workspace.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SchemaInsights;
