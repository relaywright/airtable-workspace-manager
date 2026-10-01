import React, { useState, useEffect, useCallback, useRef, Component } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import WorkspaceMap from './components/WorkspaceMap';
import BaseDetailPanel from './components/BaseDetailPanel';
import BaseSchemaMap from './components/BaseSchemaMap';
import SetupModal from './components/SetupModal';
import LoadingSpinner from './components/LoadingSpinner';
import TagManager from './components/TagManager';
import SchemaHistory from './components/SchemaHistory';
import ExportModal from './components/ExportModal';
import { ToastContainer } from './components/Toast';
import ChangeLog from './components/ChangeLog';
import SearchPanel from './components/SearchPanel';
import WorkspaceHealth from './components/WorkspaceHealth';
import SchemaInsights from './components/SchemaInsights';
import DemoBanner from './components/DemoBanner';
import BackupsPanel from './components/BackupsPanel';
import { logger } from './utils/logger';

function AppContent() {
  const {
    bases,
    selectedBase,
    isLoading,
    error,
    hasToken,
    showSetupModal,
    setShowSetupModal,
    refreshSchemas,
    checkToken,
    toasts,
    removeToast,
    syncProgress,
    changeLogRequested,
    setChangeLogRequested,
    isDemoMode,
  } = useAppContext();

  // State for showing the detailed schema map view
  const [viewingBase, setViewingBase] = useState(null);
  // State for showing the tag manager modal
  const [showTagManager, setShowTagManager] = useState(false);
  // State for showing schema history for a base
  const [historyBase, setHistoryBase] = useState(null);
  // State for showing export modal
  const [showExportModal, setShowExportModal] = useState(false);
  // State for showing the change log
  const [showChangeLog, setShowChangeLog] = useState(false);
  // State for showing the search panel
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  // State for showing workspace health dashboard
  const [showHealth, setShowHealth] = useState(false);
  // State for showing AI schema insights
  const [showInsights, setShowInsights] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  // Ref to workspace map for PNG export
  const workspaceMapRef = useRef(null);
  // Track filtered base IDs from sidebar for export filtering
  const [filteredBaseIds, setFilteredBaseIds] = useState([]);

  useEffect(() => {
    checkToken();
  }, [checkToken]);

  // Open ChangeLog when requested via toast action
  useEffect(() => {
    if (changeLogRequested) {
      setShowChangeLog(true);
      setChangeLogRequested(false);
    }
  }, [changeLogRequested, setChangeLogRequested]);

  const handleSettingsClick = useCallback(() => {
    setShowSetupModal(true);
  }, [setShowSetupModal]);

  // When a base is selected and user wants to view its schema
  const handleViewSchema = useCallback((base) => {
    setViewingBase(base);
  }, []);

  const handleBackToWorkspace = useCallback(() => {
    setViewingBase(null);
  }, []);

  const handleManageTags = useCallback(() => {
    setShowTagManager(true);
  }, []);

  const handleViewHistory = useCallback((base) => {
    setHistoryBase(base);
  }, []);

  const handleExport = useCallback(() => {
    setShowExportModal(true);
  }, []);

  const handleOpenChangeLog = useCallback(() => {
    setShowChangeLog(true);
  }, []);

  const handleOpenBackups = useCallback(() => {
    setShowBackups(true);
  }, []);

  const handleSearch = useCallback(() => {
    setShowSearchPanel(true);
  }, []);

  const handleHealth = useCallback(() => {
    setShowHealth(true);
  }, []);

  const handleInsights = useCallback(() => {
    setShowInsights(true);
  }, []);

  const handleExportMap = useCallback(() => {
    if (workspaceMapRef.current) {
      return workspaceMapRef.current.exportAsPng();
    }
    return null;
  }, []);

  const handleFilteredBasesChange = useCallback((ids) => {
    setFilteredBaseIds(ids);
  }, []);

  const handleExportSelected = useCallback((ids) => {
    setFilteredBaseIds(ids);
    setShowExportModal(true);
  }, []);

  // If viewing a specific base's schema, show that view
  if (viewingBase) {
    return (
      <div className="flex flex-col h-screen bg-background">
        {isDemoMode && <DemoBanner />}
        <BaseSchemaMap base={viewingBase} onBack={handleBackToWorkspace} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {isDemoMode && <DemoBanner />}
      <Header
        onSettingsClick={handleSettingsClick}
        onRefresh={refreshSchemas}
        onExport={handleExport}
        onSearch={handleSearch}
        onHealth={handleHealth}
        onInsights={handleInsights}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onViewSchema={handleViewSchema}
          onManageTags={handleManageTags}
          onOpenChangeLog={handleOpenChangeLog}
          onOpenBackups={handleOpenBackups}
          onFilteredBasesChange={handleFilteredBasesChange}
          onExportSelected={handleExportSelected}
        />

        <main className="flex-1 relative overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <div className="flex flex-col items-center gap-4">
                <LoadingSpinner
                  size="large"
                  message={
                    syncProgress?.phase === 'fetching-schemas'
                      ? `Fetching schemas... ${syncProgress.current}/${syncProgress.total}`
                      : syncProgress?.phase === 'detecting-relationships'
                        ? 'Detecting relationships...'
                        : 'Loading workspace...'
                  }
                />
                {syncProgress?.phase === 'fetching-schemas' && syncProgress.total > 0 && (
                  <div className="w-64">
                    <div className="h-2 bg-surfaceLight rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-textMuted mt-2 text-center truncate">
                      {syncProgress.baseName}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-error/10 border border-error rounded-lg p-6 max-w-md text-center">
                <p className="text-error font-medium mb-2">Error</p>
                <p className="text-textSecondary">{error}</p>
                <button
                  onClick={refreshSchemas}
                  className="mt-4 px-4 py-2 bg-accent hover:bg-accentHover rounded-lg text-white transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && bases.length === 0 && hasToken && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4">📊</div>
                <h2 className="text-xl font-semibold text-textPrimary mb-2">No Bases Found</h2>
                <p className="text-textSecondary mb-4">
                  Click the refresh button to fetch your Airtable bases.
                </p>
                <button
                  onClick={refreshSchemas}
                  className="px-4 py-2 bg-accent hover:bg-accentHover rounded-lg text-white transition-colors"
                >
                  Fetch Bases
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && !hasToken && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4">🔑</div>
                <h2 className="text-xl font-semibold text-textPrimary mb-2">Welcome to Workspace Manager</h2>
                <p className="text-textSecondary mb-4">Connect your Airtable account to get started.</p>
                <button
                  onClick={handleSettingsClick}
                  className="px-4 py-2 bg-accent hover:bg-accentHover rounded-lg text-white transition-colors"
                >
                  Add API Token
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && bases.length > 0 && (
            <WorkspaceMap ref={workspaceMapRef} onViewSchema={handleViewSchema} />
          )}
        </main>

        {selectedBase && (
          <BaseDetailPanel onViewSchema={handleViewSchema} onViewHistory={handleViewHistory} />
        )}
      </div>

      {showSetupModal && <SetupModal onClose={() => setShowSetupModal(false)} />}

      <TagManager isOpen={showTagManager} onClose={() => setShowTagManager(false)} />

      <SchemaHistory base={historyBase} isOpen={!!historyBase} onClose={() => setHistoryBase(null)} />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExportMap={handleExportMap}
        filteredBaseIds={filteredBaseIds}
        selectedBaseId={selectedBase?.id || null}
      />

      <ChangeLog isOpen={showChangeLog} onClose={() => setShowChangeLog(false)} />

      <SearchPanel isOpen={showSearchPanel} onClose={() => setShowSearchPanel(false)} />

      <WorkspaceHealth isOpen={showHealth} onClose={() => setShowHealth(false)} />

      <SchemaInsights isOpen={showInsights} onClose={() => setShowInsights(false)} />

      <BackupsPanel isOpen={showBackups} onClose={() => setShowBackups(false)} />

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    logger.error('ErrorBoundary', 'Caught error:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="bg-surface border border-surfaceLight rounded-xl p-8 max-w-md text-center shadow-lg">
            <div className="text-4xl mb-4">Something went wrong</div>
            <p className="text-textSecondary mb-2">
              The app hit an unexpected error. Your data is safe. Try reloading.
            </p>
            <p className="text-xs text-textMuted mb-6 font-mono bg-background rounded p-2 break-all">
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-6 py-2 bg-accent hover:bg-accentHover rounded-lg text-white transition-colors font-medium"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
