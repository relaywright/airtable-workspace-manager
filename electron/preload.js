const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('api', {
  // Token management
  getToken: () => ipcRenderer.invoke('get-token'),
  setToken: (token) => ipcRenderer.invoke('set-token', token),
  testConnection: (token) => ipcRenderer.invoke('test-connection', token),

  // Database operations
  getBases: (includeArchived = true) => ipcRenderer.invoke('get-bases', includeArchived),
  getBase: (baseId) => ipcRenderer.invoke('get-base', baseId),
  getRelationships: () => ipcRenderer.invoke('get-relationships'),
  archiveBase: (baseId) => ipcRenderer.invoke('archive-base', baseId),
  unarchiveBase: (baseId) => ipcRenderer.invoke('unarchive-base', baseId),

  // Airtable API operations
  fetchAllBases: () => ipcRenderer.invoke('fetch-all-bases'),
  fetchBaseSchema: (baseId) => ipcRenderer.invoke('fetch-base-schema', baseId),
  refreshSchemas: () => ipcRenderer.invoke('refresh-schemas'),
  detectRelationships: () => ipcRenderer.invoke('detect-relationships'),

  // Demo mode (explore a fictional workspace, no Airtable account needed)
  enterDemoMode: () => ipcRenderer.invoke('enter-demo-mode'),
  exitDemoMode: () => ipcRenderer.invoke('exit-demo-mode'),
  isDemoMode: () => ipcRenderer.invoke('is-demo-mode'),

  // User data operations
  updateBaseDescription: (baseId, description) =>
    ipcRenderer.invoke('update-base-description', baseId, description),
  updateRelationship: (id, updates) => ipcRenderer.invoke('update-relationship', id, updates),
  updateBaseTags: (baseId, tags) => ipcRenderer.invoke('update-base-tags', baseId, tags),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  renameTag: (oldName, newName) => ipcRenderer.invoke('rename-tag', oldName, newName),
  deleteTag: (tagName) => ipcRenderer.invoke('delete-tag', tagName),

  // Schema history
  getSnapshots: (baseId, limit) => ipcRenderer.invoke('get-snapshots', baseId, limit),
  getAllSnapshots: (limit) => ipcRenderer.invoke('get-all-snapshots', limit),
  compareSnapshots: (baseId, snapshotId1, snapshotId2) =>
    ipcRenderer.invoke('compare-snapshots', baseId, snapshotId1, snapshotId2),

  // Settings
  clearData: () => ipcRenderer.invoke('clear-data'),
  getLastSync: () => ipcRenderer.invoke('get-last-sync'),
  setLastSync: (timestamp) => ipcRenderer.invoke('set-last-sync', timestamp),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  getAllSettings: () => ipcRenderer.invoke('get-all-settings'),

  // Naming convention
  getNamingConvention: () => ipcRenderer.invoke('get-naming-convention'),
  setNamingConvention: (convention) => ipcRenderer.invoke('set-naming-convention', convention),

  // Schema search
  searchSchemas: (query, options) => ipcRenderer.invoke('search-schemas', query, options),

  // Export
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  exportInventoryCsv: (filterBaseIds) => ipcRenderer.invoke('export-inventory-csv', filterBaseIds),
  exportInventoryJson: (filterBaseIds) => ipcRenderer.invoke('export-inventory-json', filterBaseIds),
  exportMarkdown: (filterBaseIds) => ipcRenderer.invoke('export-markdown', filterBaseIds),
  exportMermaid: (filterBaseIds) => ipcRenderer.invoke('export-mermaid', filterBaseIds),

  // Dependency & impact analysis
  getImpactReport: (baseId) => ipcRenderer.invoke('get-impact-report', baseId),
  detectCircularDeps: () => ipcRenderer.invoke('detect-circular-deps'),
  traceSyncChains: () => ipcRenderer.invoke('trace-sync-chains'),
  classifyBases: () => ipcRenderer.invoke('classify-bases'),

  // Account management
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  getActiveAccount: () => ipcRenderer.invoke('get-active-account'),
  addAccount: (name, token) => ipcRenderer.invoke('add-account', name, token),
  removeAccount: (accountId) => ipcRenderer.invoke('remove-account', accountId),
  switchAccount: (accountId) => ipcRenderer.invoke('switch-account', accountId),

  // Scheduled refresh
  getRefreshSchedule: () => ipcRenderer.invoke('get-refresh-schedule'),
  setRefreshSchedule: (interval) => ipcRenderer.invoke('set-refresh-schedule', interval),

  // Health dashboard
  getHealthStats: () => ipcRenderer.invoke('get-health-stats'),

  // Backups
  backupNow: () => ipcRenderer.invoke('backup-now'),
  getBackupOverview: () => ipcRenderer.invoke('get-backup-overview'),
  getRestorePoints: (baseId) => ipcRenderer.invoke('get-restore-points', baseId),

  // AI-powered analysis
  getAiKey: () => ipcRenderer.invoke('get-ai-key'),
  setAiKey: (key) => ipcRenderer.invoke('set-ai-key', key),
  testAiKey: (key) => ipcRenderer.invoke('test-ai-key', key),
  analyzeBase: (baseId) => ipcRenderer.invoke('analyze-base', baseId),
  analyzeWorkspace: () => ipcRenderer.invoke('analyze-workspace'),
  generateDocumentation: (baseId) => ipcRenderer.invoke('generate-documentation', baseId),

  // Progress events
  onSyncProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('sync-progress', handler);
    return () => ipcRenderer.removeListener('sync-progress', handler);
  },
  onScheduledRefreshStarted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('scheduled-refresh-started', handler);
    return () => ipcRenderer.removeListener('scheduled-refresh-started', handler);
  },
  onScheduledRefreshCompleted: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('scheduled-refresh-completed', handler);
    return () => ipcRenderer.removeListener('scheduled-refresh-completed', handler);
  },
  onBackupProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('backup-progress', handler);
    return () => ipcRenderer.removeListener('backup-progress', handler);
  },
});
