import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { pluralize } from '../utils/format';
import { logger } from '../utils/logger';

const AppContext = createContext(null);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

export function AppProvider({ children }) {
  const [bases, setBases] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [selectedBase, setSelectedBase] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasToken, setHasToken] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [allTags, setAllTags] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const [showArchived, setShowArchived] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null); // { phase, current, total, baseName }
  const [changeLogRequested, setChangeLogRequested] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [namingConvention, setNamingConventionState] = useState({
    enabled: false,
    prefix: '',
    label: 'Matches convention',
  });
  const [isDemoMode, setIsDemoMode] = useState(false);
  const selectBaseIdRef = useRef(null); // Tracks which base we're loading — prevents stale async overwrites

  // Listen for sync progress events from the main process
  useEffect(() => {
    if (window.api?.onSyncProgress) {
      const cleanup = window.api.onSyncProgress((data) => {
        setSyncProgress(data);
      });
      return cleanup;
    }
  }, []);

  // Listen for scheduled refresh events (background auto-sync)
  useEffect(() => {
    const cleanups = [];
    if (window.api?.onScheduledRefreshStarted) {
      cleanups.push(
        window.api.onScheduledRefreshStarted(() => {
          logger.info('AppContext', 'Scheduled refresh started');
        }),
      );
    }
    if (window.api?.onScheduledRefreshCompleted) {
      cleanups.push(
        window.api.onScheduledRefreshCompleted(async (data) => {
          logger.info('AppContext', 'Scheduled refresh completed', data);
          if (data.error) {
            return; // silently fail for background refreshes
          }
          // Reload data after background refresh
          try {
            const basesResult = await window.api.getBases();
            if (basesResult.success && basesResult.data) {
              setBases(basesResult.data);
            }
            const relResult = await window.api.getRelationships();
            if (relResult.success && relResult.data) {
              setRelationships(relResult.data);
            }
            const syncResult = await window.api.getLastSync();
            if (syncResult.success && syncResult.data) {
              setLastSync(syncResult.data);
            }
          } catch (err) {
            logger.error('AppContext', 'Error reloading after scheduled refresh:', err);
          }
        }),
      );
    }
    return () => cleanups.filter(Boolean).forEach((fn) => fn());
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 5000, options = {}) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [
      ...prev,
      { id, message, type, duration, action: options.action, actionLabel: options.actionLabel },
    ]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshTags = useCallback(async () => {
    try {
      const result = await window.api.getAllTags();
      if (result.success && result.data) {
        setAllTags(result.data);
      }
    } catch (err) {
      logger.error('AppContext', 'Error refreshing tags:', err);
    }
  }, []);

  // Checks whether demo mode is currently active in the main process. Called
  // after every action that can start or end demo mode (see loadAccounts,
  // refreshBases, enterDemoMode, exitDemoMode) so the DemoBanner stays in
  // sync without needing a dedicated push event from main.js.
  const refreshDemoModeStatus = useCallback(async () => {
    try {
      const active = await window.api.isDemoMode();
      setIsDemoMode(!!active);
    } catch (err) {
      logger.error('AppContext', 'Error checking demo mode:', err);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const accts = await window.api.getAccounts();
      setAccounts(accts?.success ? accts.data || [] : []);
      const active = await window.api.getActiveAccount();
      setActiveAccount(active?.success ? active.data || null : null);
    } catch (err) {
      logger.error('AppContext', 'Error loading accounts:', err);
    }
    await refreshDemoModeStatus();
  }, [refreshDemoModeStatus]);

  const switchAccount = useCallback(
    async (accountId) => {
      setIsSwitchingAccount(true);
      setError(null);
      try {
        // Clear current state
        setBases([]);
        setRelationships([]);
        setSelectedBase(null);
        setLastSync(null);
        setAllTags([]);

        // Tell main process to switch
        const result = await window.api.switchAccount(accountId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to switch account');
        }

        // Update account state
        await loadAccounts();

        // Reload data from new database
        const tokenStatus = await window.api.getToken();
        const hasSavedToken = !!tokenStatus?.hasToken;
        setHasToken(hasSavedToken);
        if (hasSavedToken) {
          const basesResult = await window.api.getBases();
          if (basesResult.success && basesResult.data) {
            setBases(basesResult.data);
          }
          const relResult = await window.api.getRelationships();
          if (relResult.success && relResult.data) {
            setRelationships(relResult.data);
          }
          const syncResult = await window.api.getLastSync();
          if (syncResult.success && syncResult.data) {
            setLastSync(syncResult.data);
          }
          await refreshTags();
        }
      } catch (err) {
        logger.error('AppContext', 'Error switching account:', err);
        setError(err.message);
      } finally {
        setIsSwitchingAccount(false);
      }
    },
    [loadAccounts, refreshTags],
  );

  const checkToken = useCallback(async () => {
    try {
      logger.debug('AppContext', 'checkToken starting...');
      // Load accounts
      await loadAccounts();
      const tokenStatus = await window.api.getToken();
      const hasSavedToken = !!tokenStatus?.hasToken;
      const demo = await window.api.isDemoMode();
      setHasToken(hasSavedToken || demo);
      if (!hasSavedToken && !demo) {
        logger.debug('AppContext', 'No token found, showing setup modal');
        setShowSetupModal(true);
      } else {
        // Load bases from database
        logger.debug('AppContext', 'Loading bases...');
        const result = await window.api.getBases();
        if (result.success && result.data) {
          logger.debug('AppContext', `Loaded ${result.data.length} bases`);
          setBases(result.data);
        }
        // Load relationships
        logger.debug('AppContext', 'Loading relationships...');
        const relResult = await window.api.getRelationships();
        if (relResult.success && relResult.data) {
          logger.debug('AppContext', `Loaded ${relResult.data.length} relationships`);
          setRelationships(relResult.data);
        }
        // Get last sync time. Also clears a stale value, e.g. the demo's
        // sync time after exiting demo into an account that never synced.
        const syncResult = await window.api.getLastSync();
        if (syncResult.success) {
          setLastSync(syncResult.data || null);
        }
        // Load all tags
        await refreshTags();
        // Load naming convention
        try {
          const convention = await window.api.getNamingConvention();
          if (convention) setNamingConventionState(convention);
        } catch (err) {
          logger.error('AppContext', 'Error loading naming convention:', err);
        }
        logger.debug('AppContext', 'checkToken complete');
      }
    } catch (err) {
      logger.error('AppContext', 'Error in checkToken:', err);
      setError(err.message);
    }
  }, [refreshTags, loadAccounts]);

  const refreshBases = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // First fetch all bases
      const fetchResult = await window.api.fetchAllBases();
      if (!fetchResult.success) {
        throw new Error(fetchResult.error);
      }

      // Then load from database
      const result = await window.api.getBases();
      if (result.success && result.data) {
        setBases(result.data);
      }

      // Update last sync time
      const now = new Date().toISOString();
      await window.api.setLastSync(now);
      setLastSync(now);

      // set-token exits demo mode in the main process if it was active —
      // reflect that here.
      await refreshDemoModeStatus();
    } catch (err) {
      logger.error('AppContext', 'Error refreshing bases:', err);
      // set-token leaves sample data before the fetch runs, so a failed fetch
      // can still mean a different database is active. Reload what it holds.
      await checkToken();
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [refreshDemoModeStatus, checkToken]);

  const enterDemoMode = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.api.enterDemoMode();
      if (!result.success) {
        setError(result.error || 'Failed to start the demo workspace');
        return result;
      }
      setShowSetupModal(false);
      // Reloads bases/relationships from the now-active demo database and
      // refreshes isDemoMode() so the DemoBanner appears.
      await checkToken();
      return { success: true };
    } catch (err) {
      logger.error('AppContext', 'Error entering demo mode:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, [checkToken]);

  const exitDemoMode = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.api.exitDemoMode();
      // Reloads the real account's bases/relationships and refreshes
      // isDemoMode() so the DemoBanner disappears.
      await checkToken();
      return result;
    } catch (err) {
      logger.error('AppContext', 'Error exiting demo mode:', err);
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, [checkToken]);

  const refreshSchemas = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSyncProgress(null);
    try {
      const result = await window.api.refreshSchemas();
      if (!result.success) {
        throw new Error(result.error);
      }

      // Reload bases from database
      const basesResult = await window.api.getBases();
      if (basesResult.success && basesResult.data) {
        setBases(basesResult.data);
        logger.debug('AppContext', 'Loaded', basesResult.data.length, 'bases');
      }

      // Reload relationships
      const relResult = await window.api.getRelationships();
      if (relResult.success && relResult.data) {
        setRelationships(relResult.data);
        logger.debug('AppContext', 'Loaded', relResult.data.length, 'relationships');
      }

      // Update last sync time
      const now = new Date().toISOString();
      await window.api.setLastSync(now);
      setLastSync(now);

      // Show toast if schema changes were detected
      if (result.changedBases && result.changedBases.length > 0) {
        const baseNames = result.changedBases.map((b) => b.name).join(', ');
        addToast(
          `Schema changes detected in ${pluralize(result.changedBases.length, 'base')}: ${baseNames}`,
          'info',
          8000,
          {
            action: () => setChangeLogRequested(true),
            actionLabel: 'View Changes',
          },
        );
      }

      // Show toast if bases were archived
      if (result.archivedBases && result.archivedBases.length > 0) {
        const baseNames = result.archivedBases.map((b) => b.name).join(', ');
        addToast(
          `${pluralize(result.archivedBases.length, 'base')} archived (no longer in Airtable): ${baseNames}`,
          'warning',
          8000,
        );
      }

      return {
        success: true,
        basesUpdated: result.basesUpdated,
        changedBases: result.changedBases,
        archivedBases: result.archivedBases,
      };
    } catch (err) {
      logger.error('AppContext', 'Error refreshing schemas:', err);
      setError(err.message);
      addToast(`Failed to refresh: ${err.message}`, 'error');
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
      setSyncProgress(null);
    }
  }, [addToast]);

  const selectBase = useCallback(async (base) => {
    if (!base) {
      selectBaseIdRef.current = null;
      setSelectedBase(null);
      return;
    }
    // Track which base we intended to select
    const requestedId = base.id;
    selectBaseIdRef.current = requestedId;

    // Set immediately with lite data for responsive UI
    setSelectedBase(base);
    // Load full base data (with schema) on demand
    try {
      const result = await window.api.getBase(base.id);
      // Only apply if this is still the base the user wants (prevents stale overwrites)
      if (selectBaseIdRef.current === requestedId && result.success && result.data) {
        setSelectedBase(result.data);
      }
    } catch (err) {
      logger.error('AppContext', 'Error loading full base data:', err);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedBase(null);
  }, []);

  const updateBaseDescription = useCallback(
    async (baseId, description) => {
      try {
        const result = await window.api.updateBaseDescription(baseId, description);
        if (result.success) {
          setBases((prev) => prev.map((b) => (b.id === baseId ? { ...b, userDescription: description } : b)));
          if (selectedBase?.id === baseId) {
            setSelectedBase((prev) => ({ ...prev, userDescription: description }));
          }
        }
        return result;
      } catch (err) {
        logger.error('AppContext', 'Error updating description:', err);
        return { success: false, error: err.message };
      }
    },
    [selectedBase],
  );

  const detectRelationships = useCallback(async () => {
    try {
      const result = await window.api.detectRelationships();
      if (result.success && result.data) {
        setRelationships(result.data);
        return { success: true, stats: result.stats };
      }
      return { success: false, error: result.error };
    } catch (err) {
      logger.error('AppContext', 'Error detecting relationships:', err);
      return { success: false, error: err.message };
    }
  }, []);

  const updateRelationship = useCallback(async (id, updates) => {
    // Optimistic update
    setRelationships((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));

    try {
      const result = await window.api.updateRelationship(id, updates);
      if (result.success && result.data) {
        // Update with server response
        setRelationships((prev) => prev.map((r) => (r.id === id ? result.data : r)));
        return { success: true };
      }
      // Revert on failure
      const relResult = await window.api.getRelationships();
      if (relResult.success && relResult.data) {
        setRelationships(relResult.data);
      }
      return { success: false, error: result.error };
    } catch (err) {
      logger.error('AppContext', 'Error updating relationship:', err);
      // Revert on error
      const relResult = await window.api.getRelationships();
      if (relResult.success && relResult.data) {
        setRelationships(relResult.data);
      }
      return { success: false, error: err.message };
    }
  }, []);

  const updateBaseTags = useCallback(
    async (baseId, tags) => {
      // Optimistic update
      const tagsJson = JSON.stringify(tags);
      setBases((prev) => prev.map((b) => (b.id === baseId ? { ...b, userTags: tagsJson } : b)));
      if (selectedBase?.id === baseId) {
        setSelectedBase((prev) => ({ ...prev, userTags: tagsJson }));
      }

      try {
        const result = await window.api.updateBaseTags(baseId, tags);
        if (result.success) {
          await refreshTags();
          return { success: true };
        }
        // Revert on failure
        const basesResult = await window.api.getBases();
        if (basesResult.success && basesResult.data) {
          setBases(basesResult.data);
        }
        return { success: false, error: result.error };
      } catch (err) {
        logger.error('AppContext', 'Error updating tags:', err);
        const basesResult = await window.api.getBases();
        if (basesResult.success && basesResult.data) {
          setBases(basesResult.data);
        }
        return { success: false, error: err.message };
      }
    },
    [selectedBase, refreshTags],
  );

  const renameTag = useCallback(
    async (oldName, newName) => {
      try {
        const result = await window.api.renameTag(oldName, newName);
        if (result.success) {
          // Reload bases and tags
          const basesResult = await window.api.getBases();
          if (basesResult.success && basesResult.data) {
            setBases(basesResult.data);
          }
          await refreshTags();
          return { success: true };
        }
        return { success: false, error: result.error };
      } catch (err) {
        logger.error('AppContext', 'Error renaming tag:', err);
        return { success: false, error: err.message };
      }
    },
    [refreshTags],
  );

  const deleteTag = useCallback(
    async (tagName) => {
      try {
        const result = await window.api.deleteTag(tagName);
        if (result.success) {
          // Reload bases and tags
          const basesResult = await window.api.getBases();
          if (basesResult.success && basesResult.data) {
            setBases(basesResult.data);
          }
          await refreshTags();
          return { success: true };
        }
        return { success: false, error: result.error };
      } catch (err) {
        logger.error('AppContext', 'Error deleting tag:', err);
        return { success: false, error: err.message };
      }
    },
    [refreshTags],
  );

  const archiveBase = useCallback(
    async (baseId) => {
      try {
        const result = await window.api.archiveBase(baseId);
        if (result.success) {
          // Update local state
          setBases((prev) => prev.map((b) => (b.id === baseId ? { ...b, isArchived: 1 } : b)));
          if (selectedBase?.id === baseId) {
            setSelectedBase((prev) => ({ ...prev, isArchived: 1 }));
          }
          addToast('Base archived', 'success', 3000);
          return { success: true };
        }
        return { success: false, error: result.error };
      } catch (err) {
        logger.error('AppContext', 'Error archiving base:', err);
        return { success: false, error: err.message };
      }
    },
    [selectedBase, addToast],
  );

  const unarchiveBase = useCallback(
    async (baseId) => {
      try {
        const result = await window.api.unarchiveBase(baseId);
        if (result.success) {
          // Update local state
          setBases((prev) => prev.map((b) => (b.id === baseId ? { ...b, isArchived: 0 } : b)));
          if (selectedBase?.id === baseId) {
            setSelectedBase((prev) => ({ ...prev, isArchived: 0 }));
          }
          addToast('Base unarchived', 'success', 3000);
          return { success: true };
        }
        return { success: false, error: result.error };
      } catch (err) {
        logger.error('AppContext', 'Error unarchiving base:', err);
        return { success: false, error: err.message };
      }
    },
    [selectedBase, addToast],
  );

  const toggleShowArchived = useCallback(() => {
    setShowArchived((prev) => !prev);
  }, []);

  const bulkArchiveBases = useCallback(
    async (baseIds) => {
      let succeeded = 0;
      let failed = 0;
      for (const baseId of baseIds) {
        try {
          const result = await window.api.archiveBase(baseId);
          if (result.success) {
            setBases((prev) => prev.map((b) => (b.id === baseId ? { ...b, isArchived: 1 } : b)));
            if (selectedBase?.id === baseId) {
              setSelectedBase((prev) => ({ ...prev, isArchived: 1 }));
            }
            succeeded++;
          } else {
            failed++;
          }
        } catch (err) {
          logger.error('AppContext', `Error archiving base ${baseId}:`, err);
          failed++;
        }
      }
      if (failed === 0) {
        addToast(`Archived ${pluralize(succeeded, 'base')}`, 'success', 3000);
      } else {
        addToast(`Archived ${succeeded}, failed ${failed}`, 'warning', 5000);
      }
      return { succeeded, failed };
    },
    [selectedBase, addToast],
  );

  const bulkTagBases = useCallback(
    async (baseIds, tags) => {
      let succeeded = 0;
      let failed = 0;
      for (const baseId of baseIds) {
        try {
          // Merge new tags with existing tags on each base
          const base = bases.find((b) => b.id === baseId);
          let existingTags = [];
          if (base?.userTags) {
            try {
              existingTags = JSON.parse(base.userTags);
            } catch {
              // Malformed userTags JSON: treat as no existing tags rather than failing the whole update.
            }
          }
          const mergedTags = [...new Set([...existingTags, ...tags])];
          const result = await window.api.updateBaseTags(baseId, mergedTags);
          if (result.success) {
            const tagsJson = JSON.stringify(mergedTags);
            setBases((prev) => prev.map((b) => (b.id === baseId ? { ...b, userTags: tagsJson } : b)));
            if (selectedBase?.id === baseId) {
              setSelectedBase((prev) => ({ ...prev, userTags: tagsJson }));
            }
            succeeded++;
          } else {
            failed++;
          }
        } catch (err) {
          logger.error('AppContext', `Error tagging base ${baseId}:`, err);
          failed++;
        }
      }
      await refreshTags();
      if (failed === 0) {
        addToast(`Tagged ${pluralize(succeeded, 'base')}`, 'success', 3000);
      } else {
        addToast(`Tagged ${succeeded}, failed ${failed}`, 'warning', 5000);
      }
      return { succeeded, failed };
    },
    [bases, selectedBase, addToast, refreshTags],
  );

  const updateNamingConvention = useCallback(async (convention) => {
    try {
      const result = await window.api.setNamingConvention(convention);
      if (result.success) {
        setNamingConventionState(convention);
        // matches_convention was recomputed for every base server-side — reload to reflect it
        const basesResult = await window.api.getBases();
        if (basesResult.success && basesResult.data) {
          setBases(basesResult.data);
        }
      }
      return result;
    } catch (err) {
      logger.error('AppContext', 'Error updating naming convention:', err);
      return { success: false, error: err.message };
    }
  }, []);

  const value = {
    bases,
    relationships,
    selectedBase,
    isLoading,
    error,
    hasToken,
    showSetupModal,
    lastSync,
    allTags,
    toasts,
    showArchived,
    syncProgress,
    setShowSetupModal,
    setHasToken,
    refreshBases,
    refreshSchemas,
    detectRelationships,
    selectBase,
    clearSelection,
    updateBaseDescription,
    updateRelationship,
    updateBaseTags,
    renameTag,
    deleteTag,
    refreshTags,
    checkToken,
    setError,
    addToast,
    removeToast,
    archiveBase,
    unarchiveBase,
    toggleShowArchived,
    changeLogRequested,
    setChangeLogRequested,
    bulkArchiveBases,
    bulkTagBases,
    accounts,
    activeAccount,
    isSwitchingAccount,
    switchAccount,
    loadAccounts,
    namingConvention,
    updateNamingConvention,
    isDemoMode,
    enterDemoMode,
    exitDemoMode,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export { AppContext };
