import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { parseTimestamp } from '../utils/format';
import { logger } from '../utils/logger';

// Saved secrets stay in the main process; the UI only ever sees the last four characters.
function maskSecret(last4) {
  return `••••••••${last4 || ''}`;
}

export function SetupModal({ onClose }) {
  const {
    setHasToken,
    refreshBases,
    checkToken,
    accounts,
    activeAccount,
    loadAccounts,
    updateNamingConvention,
    enterDemoMode,
  } = useAppContext();

  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState(null);
  const [isReplacingToken, setIsReplacingToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingDemo, setIsStartingDemo] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  // Account management
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountToken, setNewAccountToken] = useState('');
  const [showNewToken, setShowNewToken] = useState(false);
  const [isTestingNew, setIsTestingNew] = useState(false);
  const [newTestResult, setNewTestResult] = useState(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  // Detection settings
  const [structuralThreshold, setStructuralThreshold] = useState(0.7);
  const [confirmedThreshold, setConfirmedThreshold] = useState(0.9);
  const [snapshotRetention, setSnapshotRetention] = useState(10);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // AI features
  const [aiKey, setAiKey] = useState('');
  const [savedAiKey, setSavedAiKey] = useState(null);
  const [isReplacingAiKey, setIsReplacingAiKey] = useState(false);
  const [showAiKey, setShowAiKey] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);

  // Sync schedule
  const [refreshSchedule, setRefreshSchedule] = useState('off');

  // Naming convention
  const [conventionEnabled, setConventionEnabled] = useState(false);
  const [conventionPrefix, setConventionPrefix] = useState('');
  const [conventionLabel, setConventionLabel] = useState('Matches convention');
  const [conventionSaved, setConventionSaved] = useState(false);
  const [isSavingConvention, setIsSavingConvention] = useState(false);

  useEscapeKey(onClose);

  // A freshly created account can exist before it has a name
  const activeAccountName = activeAccount?.name?.trim();

  // With a saved secret and no replacement typed, actions run against the saved one in main.
  const typedToken = token.trim();
  const usingSavedToken = !!savedToken && !isReplacingToken;
  const canUseToken = !!typedToken || usingSavedToken;
  const typedAiKey = aiKey.trim();
  const usingSavedAiKey = !!savedAiKey && !isReplacingAiKey;

  useEffect(() => {
    loadExistingToken();
    loadLastSync();
    loadDetectionSettings();
    loadRefreshSchedule();
    loadAiKey();
    loadNamingConvention();
  }, []);

  const loadExistingToken = async () => {
    try {
      const status = await window.api.getToken();
      setSavedToken(status?.hasToken ? status : null);
    } catch (err) {
      logger.error('SetupModal', 'Error loading token:', err);
    }
  };

  const loadLastSync = async () => {
    try {
      const result = await window.api.getLastSync();
      if (result.success && result.data) {
        setLastSync(result.data);
      }
    } catch (err) {
      logger.error('SetupModal', 'Error loading last sync:', err);
    }
  };

  const loadRefreshSchedule = async () => {
    try {
      const result = await window.api.getRefreshSchedule();
      if (result.success && result.data) {
        setRefreshSchedule(result.data);
      }
    } catch (err) {
      logger.error('SetupModal', 'Error loading refresh schedule:', err);
    }
  };

  const handleScheduleChange = async (value) => {
    setRefreshSchedule(value);
    try {
      await window.api.setRefreshSchedule(value);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadDetectionSettings = async () => {
    try {
      const result = await window.api.getAllSettings();
      if (result.success && result.data) {
        if (result.data.structuralThreshold != null)
          setStructuralThreshold(parseFloat(result.data.structuralThreshold));
        if (result.data.confirmedThreshold != null)
          setConfirmedThreshold(parseFloat(result.data.confirmedThreshold));
        if (result.data.snapshotRetention != null)
          setSnapshotRetention(parseInt(result.data.snapshotRetention, 10));
      }
    } catch (err) {
      logger.error('SetupModal', 'Error loading detection settings:', err);
    }
  };

  const loadAiKey = async () => {
    try {
      const status = await window.api.getAiKey();
      setSavedAiKey(status?.hasKey ? status : null);
    } catch (err) {
      logger.error('SetupModal', 'Error loading AI key:', err);
    }
  };

  const handleTestAiKey = async () => {
    if (!typedAiKey && !usingSavedAiKey) return;
    setIsTestingAi(true);
    setAiTestResult(null);
    try {
      const result = typedAiKey ? await window.api.testAiKey(typedAiKey) : await window.api.testAiKey();
      setAiTestResult(result);
    } catch (err) {
      setAiTestResult({ success: false, error: err.message });
    } finally {
      setIsTestingAi(false);
    }
  };

  const handleSaveAiKey = async () => {
    if (!typedAiKey) return;
    try {
      const result = await window.api.setAiKey(typedAiKey);
      if (result && !result.success) {
        setAiTestResult({ success: false, error: result.error || 'Failed to save key' });
        return;
      }
      setAiKey('');
      setShowAiKey(false);
      setIsReplacingAiKey(false);
      await loadAiKey();
      setAiTestResult({ success: true, message: 'Key saved!' });
      setTimeout(() => setAiTestResult(null), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveAiKey = async () => {
    if (
      !window.confirm(
        'Remove the saved Anthropic API key? AI features will be turned off until you add a key again.',
      )
    ) {
      return;
    }
    try {
      const result = await window.api.setAiKey('');
      if (result && !result.success) {
        setAiTestResult({ success: false, error: result.error || 'Failed to remove key' });
        return;
      }
      await loadAiKey();
      setAiKey('');
      setShowAiKey(false);
      setIsReplacingAiKey(false);
      setAiTestResult({ success: true, message: 'Key removed' });
      setTimeout(() => setAiTestResult(null), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelReplaceAiKey = () => {
    setIsReplacingAiKey(false);
    setAiKey('');
    setAiTestResult(null);
  };

  const loadNamingConvention = async () => {
    try {
      const convention = await window.api.getNamingConvention();
      if (convention) {
        setConventionEnabled(!!convention.enabled);
        setConventionPrefix(convention.prefix || '');
        setConventionLabel(convention.label || 'Matches convention');
      }
    } catch (err) {
      logger.error('SetupModal', 'Error loading naming convention:', err);
    }
  };

  const handleSaveNamingConvention = async () => {
    setConventionSaved(false);
    setIsSavingConvention(true);
    try {
      const result = await updateNamingConvention({
        enabled: conventionEnabled,
        prefix: conventionPrefix,
        label: conventionLabel,
      });
      if (result.success) {
        setConventionSaved(true);
        setTimeout(() => setConventionSaved(false), 2000);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSavingConvention(false);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaved(false);
    try {
      await window.api.setSetting('structuralThreshold', String(structuralThreshold));
      await window.api.setSetting('confirmedThreshold', String(confirmedThreshold));
      await window.api.setSetting('snapshotRetention', String(snapshotRetention));
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTestConnection = async () => {
    if (!canUseToken) {
      setError('Please enter a token');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = typedToken
        ? await window.api.testConnection(typedToken)
        : await window.api.testConnection();
      setTestResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsTesting(false);
    }
  };

  const cancelReplaceToken = () => {
    setIsReplacingToken(false);
    setToken('');
    setTestResult(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!canUseToken) {
      setError('Please enter a token');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTestResult(null);

    try {
      const result = typedToken ? await window.api.setToken(typedToken) : await window.api.setToken();
      if (result.success) {
        setHasToken(true);
        await refreshBases();
        // A saved token that can't see any bases would leave an empty map; stay open and say why.
        if (result.baseCount === 0) {
          setTestResult(result);
        } else {
          onClose();
        }
      } else {
        setTestResult({ ...result, error: result.error || 'Failed to save token' });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearData = async () => {
    if (
      !window.confirm(
        'Are you sure you want to clear all local data? This will remove all stored bases and relationships.',
      )
    ) {
      return;
    }

    setIsLoading(true);
    try {
      await window.api.clearData();
      await checkToken();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestNewAccount = async () => {
    if (!newAccountToken.trim()) return;
    setIsTestingNew(true);
    setNewTestResult(null);
    try {
      const result = await window.api.testConnection(newAccountToken.trim());
      setNewTestResult(result);
    } catch (err) {
      setNewTestResult({ success: false, error: err.message });
    } finally {
      setIsTestingNew(false);
    }
  };

  const handleAddAccount = async () => {
    if (!newAccountName.trim() || !newAccountToken.trim()) {
      setError('Please enter both a name and token for the new account');
      return;
    }
    setIsAddingAccount(true);
    setError(null);
    try {
      const result = await window.api.addAccount(newAccountName.trim(), newAccountToken.trim());
      if (result.success) {
        await loadAccounts();
        await loadExistingToken();
        setShowAddAccount(false);
        setNewAccountName('');
        setNewAccountToken('');
        setNewTestResult(null);
      } else {
        setNewTestResult(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAddingAccount(false);
    }
  };

  const handleRemoveAccount = async (accountId, accountName) => {
    if (
      !window.confirm(
        `Remove account "${accountName}"? This will delete all stored workspace data for this account.`,
      )
    ) {
      return;
    }
    try {
      const result = await window.api.removeAccount(accountId);
      if (result.success) {
        await loadAccounts();
        await loadExistingToken();
        await checkToken();
      } else {
        setError(result.error || 'Failed to remove account');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTryDemo = async () => {
    setIsStartingDemo(true);
    setError(null);
    try {
      const result = await enterDemoMode();
      if (!result.success) {
        setError(result.error || 'Failed to start the demo workspace');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsStartingDemo(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return parseTimestamp(dateStr)?.toLocaleString() ?? 'Never';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-textPrimary">Settings</h2>
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
          {/* Accounts Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-textPrimary">Accounts</h3>
              {!showAddAccount && (
                <button
                  onClick={() => setShowAddAccount(true)}
                  className="text-xs text-accent hover:text-accentHover transition-colors"
                >
                  + Add Account
                </button>
              )}
            </div>

            {/* Account List */}
            {accounts.length > 0 ? (
              <div className="space-y-1 mb-3">
                {accounts.map((acct) => (
                  <div
                    key={acct.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                      acct.id === activeAccount?.id
                        ? 'bg-accent/10 border border-accent/30'
                        : 'bg-surfaceLight'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {acct.id === activeAccount?.id && (
                        <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                      )}
                      <span
                        className={`truncate ${acct.id === activeAccount?.id ? 'text-textPrimary' : 'text-textSecondary'}`}
                      >
                        {acct.name}
                      </span>
                    </div>
                    {accounts.length > 1 && (
                      <button
                        onClick={() => handleRemoveAccount(acct.id, acct.name)}
                        className="text-textMuted hover:text-error transition-colors shrink-0 ml-2"
                        title="Remove account"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-textMuted mb-3">No accounts configured yet.</p>
            )}

            {/* Add Account Form */}
            {showAddAccount && (
              <div className="p-3 bg-background rounded-lg border border-border space-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-textSecondary mb-1">Account Name</label>
                  <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="e.g. Work, Personal"
                    className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-textSecondary mb-1">
                    Personal Access Token
                  </label>
                  <div className="relative">
                    <input
                      type={showNewToken ? 'text' : 'password'}
                      value={newAccountToken}
                      onChange={(e) => setNewAccountToken(e.target.value)}
                      placeholder="pat..."
                      className="w-full pr-16 pl-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewToken(!showNewToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs text-textMuted hover:text-textSecondary"
                    >
                      {showNewToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestNewAccount}
                    disabled={isTestingNew || !newAccountToken.trim()}
                    className="px-3 py-1.5 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isTestingNew ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={handleAddAccount}
                    disabled={isAddingAccount || !newAccountName.trim() || !newAccountToken.trim()}
                    className="px-3 py-1.5 bg-accent hover:bg-accentHover text-white rounded-lg text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAddingAccount ? 'Adding...' : 'Add Account'}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddAccount(false);
                      setNewAccountName('');
                      setNewAccountToken('');
                      setNewTestResult(null);
                    }}
                    className="px-3 py-1.5 text-textMuted hover:text-textSecondary text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  {newTestResult && (
                    <span className={`text-xs ${newTestResult.success ? 'text-success' : 'text-error'}`}>
                      {newTestResult.success ? 'Valid!' : newTestResult.error || 'Failed'}
                      {!newTestResult.success && newTestResult.helpUrl && (
                        <>
                          {' '}
                          <a
                            href={newTestResult.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent hover:text-accentHover underline"
                          >
                            Open Airtable's token page
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Active Account Token */}
          <div className="pt-4 border-t border-border">
            <label className="block text-sm font-medium text-textPrimary mb-1">
              {activeAccountName ? `Token for "${activeAccountName}"` : 'Airtable Personal Access Token'}
            </label>
            {usingSavedToken ? (
              <div className="flex items-center gap-2">
                <div
                  aria-label="Saved token"
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono text-textSecondary"
                >
                  {maskSecret(savedToken.last4)}
                </div>
                <button
                  type="button"
                  onClick={() => setIsReplacingToken(true)}
                  className="px-3 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors"
                >
                  Replace
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="pat..."
                    className="w-full pr-20 pl-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-textMuted hover:text-textSecondary"
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
                {savedToken && (
                  <button
                    type="button"
                    onClick={cancelReplaceToken}
                    className="mt-1 text-xs text-textMuted hover:text-textSecondary transition-colors"
                  >
                    Keep saved token
                  </button>
                )}
              </>
            )}
            <p className="mt-1 text-xs text-textMuted">
              Get your token from{' '}
              <a
                href="https://airtable.com/create/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accentHover underline"
              >
                airtable.com/create/tokens
              </a>
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={handleTryDemo}
                disabled={isStartingDemo}
                className="px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStartingDemo ? 'Loading sample data...' : 'Try with sample data'}
              </button>
              <p className="mt-1 text-xs text-textMuted">
                Explore a fictional company's workspace. No Airtable account needed.
              </p>
            </div>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={isTesting || !canUseToken}
              className="px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult && (
              <div className="text-sm">
                <p
                  className={
                    testResult.success
                      ? testResult.baseCount === 0
                        ? 'text-warning'
                        : 'text-success'
                      : 'text-error'
                  }
                >
                  {testResult.success
                    ? testResult.baseCount === 0
                      ? "Connected, but this token can't see any bases yet. On Airtable's token page, edit the token and add your workspace under Access."
                      : 'Connection successful!'
                    : testResult.error || 'Connection failed'}
                </p>
                {testResult.helpUrl && (
                  <a
                    href={testResult.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accentHover underline"
                  >
                    Open Airtable's token page
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Detection Settings */}
          <div className="pt-4 border-t border-border space-y-4">
            <h3 className="text-sm font-semibold text-textPrimary">Detection Settings</h3>

            {/* Structural Match Threshold */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-textSecondary">Structural Match Threshold</label>
                <span className="text-sm font-mono text-accent">{structuralThreshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.05"
                value={structuralThreshold}
                onChange={(e) => setStructuralThreshold(parseFloat(e.target.value))}
                className="w-full accent-accent"
              />
              <p className="mt-1 text-xs text-textMuted">
                Lower = more connections detected (may include false positives). Higher = fewer but more
                confident connections.
              </p>
            </div>

            {/* Confirmed Threshold */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-textSecondary">Confirmed Threshold</label>
                <span className="text-sm font-mono text-accent">{confirmedThreshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.7"
                max="1.0"
                step="0.05"
                value={confirmedThreshold}
                onChange={(e) => setConfirmedThreshold(parseFloat(e.target.value))}
                className="w-full accent-accent"
              />
              <p className="mt-1 text-xs text-textMuted">
                Relationships above this score are marked as "confirmed" instead of "suspected."
              </p>
            </div>

            {/* Snapshot Retention */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-textSecondary">Snapshot Retention</label>
              </div>
              <input
                type="number"
                min="1"
                max="100"
                value={snapshotRetention}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1 && val <= 100) setSnapshotRetention(val);
                }}
                className="w-20 px-2 py-1 bg-background border border-border rounded text-sm text-textPrimary focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-textMuted">
                How many schema snapshots to keep per base (1-100).
              </p>
            </div>

            {/* Save Settings Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors"
              >
                Save Detection Settings
              </button>
              {settingsSaved && <span className="text-sm text-success">Settings saved!</span>}
            </div>
          </div>

          {/* Naming Convention */}
          <div className="pt-4 border-t border-border space-y-3">
            <h3 className="text-sm font-semibold text-textPrimary">Naming Convention</h3>
            <p className="text-xs text-textMuted">
              Mark bases whose names start with a prefix, for example bases rebuilt under a new standard.
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={conventionEnabled}
                onChange={(e) => setConventionEnabled(e.target.checked)}
                className="accent-accent w-4 h-4 cursor-pointer"
              />
              <span className="text-sm text-textSecondary">Enable naming convention</span>
            </label>

            <div>
              <label className="block text-sm text-textSecondary mb-1">Prefix</label>
              <input
                type="text"
                value={conventionPrefix}
                onChange={(e) => setConventionPrefix(e.target.value)}
                placeholder="e.g. V2"
                disabled={!conventionEnabled}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm text-textSecondary mb-1">Label</label>
              <input
                type="text"
                value={conventionLabel}
                onChange={(e) => setConventionLabel(e.target.value)}
                placeholder="Matches convention"
                disabled={!conventionEnabled}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveNamingConvention}
                disabled={isSavingConvention}
                className="px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save Naming Convention
              </button>
              {conventionSaved && <span className="text-sm text-success">Naming convention saved!</span>}
            </div>
          </div>

          {/* Sync Schedule */}
          <div className="pt-4 border-t border-border space-y-3">
            <h3 className="text-sm font-semibold text-textPrimary">Sync Schedule</h3>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'off', label: 'Off' },
                { value: 'hourly', label: 'Hourly' },
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleScheduleChange(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    refreshSchedule === opt.value
                      ? 'bg-accent text-white'
                      : 'bg-surfaceLight text-textSecondary hover:bg-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-textMuted">
              Automatically sync your workspace on a schedule. The app must be running for scheduled syncs to
              work.
            </p>
          </div>

          {/* AI Features */}
          <div className="pt-4 border-t border-border space-y-3">
            <h3 className="text-sm font-semibold text-textPrimary">AI Features</h3>
            <div>
              <label className="block text-sm text-textSecondary mb-1">Anthropic API Key</label>
              {usingSavedAiKey ? (
                <div className="flex items-center gap-2">
                  <div
                    aria-label="Saved Anthropic API key"
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono text-textSecondary"
                  >
                    {maskSecret(savedAiKey.last4)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsReplacingAiKey(true)}
                    className="px-3 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors"
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <input
                      type={showAiKey ? 'text' : 'password'}
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="w-full pr-20 pl-3 py-2 bg-background border border-border rounded-lg text-sm text-textPrimary placeholder-textMuted focus:border-accent focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAiKey(!showAiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-textMuted hover:text-textSecondary"
                    >
                      {showAiKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {savedAiKey && (
                    <button
                      type="button"
                      onClick={cancelReplaceAiKey}
                      className="mt-1 text-xs text-textMuted hover:text-textSecondary transition-colors"
                    >
                      Keep saved key
                    </button>
                  )}
                </>
              )}
              <p className="mt-1 text-xs text-textMuted">
                Optional. Schema Insights uses this key to ask Claude for schema suggestions and documentation
                drafts.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleTestAiKey}
                disabled={isTestingAi || (!typedAiKey && !usingSavedAiKey)}
                className="px-3 py-1.5 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isTestingAi ? 'Testing...' : 'Test'}
              </button>
              {!usingSavedAiKey && (
                <button
                  onClick={handleSaveAiKey}
                  disabled={!typedAiKey}
                  className="px-3 py-1.5 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Key
                </button>
              )}
              {usingSavedAiKey && (
                <button
                  type="button"
                  onClick={handleRemoveAiKey}
                  className="px-3 py-1.5 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg text-sm transition-colors"
                >
                  Remove key
                </button>
              )}
              {aiTestResult && (
                <span className={`text-sm ${aiTestResult.success ? 'text-success' : 'text-error'}`}>
                  {aiTestResult.success
                    ? aiTestResult.message || 'Key valid!'
                    : aiTestResult.error || 'Invalid key'}
                </span>
              )}
            </div>
          </div>

          {/* Last sync info */}
          {lastSync && (
            <div className="pt-4 border-t border-border">
              <p className="text-sm text-textMuted">Last sync: {formatDate(lastSync)}</p>
            </div>
          )}

          {/* Clear data */}
          <div className="pt-4 border-t border-border">
            <button
              onClick={handleClearData}
              disabled={isLoading}
              className="text-sm text-error hover:text-error/80 transition-colors disabled:opacity-50"
            >
              Clear all local data
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surfaceLight hover:bg-border text-textSecondary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading || !canUseToken}
            className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Saving...' : 'Save & Fetch Bases'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SetupModal;
