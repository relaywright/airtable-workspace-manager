import { vi } from 'vitest';

// Sample test data
export const mockBases = [
  {
    id: 'app123',
    name: 'V2 - Test Base',
    permissionLevel: 'create',
    tableCount: 5,
    fieldCount: 25,
    matchesConvention: 1,
    userDescription: 'A test description',
    schemaJson: JSON.stringify({
      tables: [
        {
          id: 'tbl1',
          name: 'Products',
          fields: [
            { id: 'fld1', name: 'Name', type: 'singleLineText' },
            { id: 'fld2', name: 'Price', type: 'number' },
          ],
        },
      ],
    }),
  },
  {
    id: 'app456',
    name: 'Legacy Base',
    permissionLevel: 'edit',
    tableCount: 3,
    fieldCount: 15,
    matchesConvention: 0,
    userDescription: null,
    schemaJson: null,
  },
];

export const mockRelationships = [
  {
    id: 1,
    sourceBaseId: 'app123',
    targetBaseId: 'app456',
    sourceTableName: 'Products',
    targetTableName: 'SYNC Products',
    confidence: 'confirmed',
    detectionReason: 'Table name contains SYNC; 85% field similarity',
  },
];

export const mockApiResponse = {
  bases: [
    { id: 'app123', name: 'V2 - Test Base', permissionLevel: 'create' },
    { id: 'app456', name: 'Legacy Base', permissionLevel: 'edit' },
  ],
};

export const mockSchemaResponse = {
  tables: [
    {
      id: 'tbl1',
      name: 'Products',
      fields: [
        { id: 'fld1', name: 'Name', type: 'singleLineText' },
        { id: 'fld2', name: 'Price', type: 'number' },
        { id: 'fld3', name: 'Description', type: 'multilineText' },
      ],
    },
    {
      id: 'tbl2',
      name: 'Orders',
      fields: [
        { id: 'fld4', name: 'Order ID', type: 'singleLineText' },
        { id: 'fld5', name: 'Customer', type: 'singleLineText' },
      ],
    },
  ],
};

// Mock window.api with controllable responses.
// Covers every window.api.* method reached by components/context under test.
// Returns `{ success: true, ... }` by default so happy paths don't crash;
// individual tests override per case.
export function createMockApi(overrides = {}) {
  return {
    // Auth / accounts
    getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
    setToken: vi.fn().mockResolvedValue({ success: true }),
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    getAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getActiveAccount: vi.fn().mockResolvedValue({ success: true, data: null }),
    switchAccount: vi.fn().mockResolvedValue({ success: true }),
    addAccount: vi.fn().mockResolvedValue({ success: true }),
    removeAccount: vi.fn().mockResolvedValue({ success: true }),

    // Bases / schemas
    getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getBase: vi.fn().mockResolvedValue({ success: true, data: null }),
    getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
    fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
    fetchBaseSchema: vi.fn().mockResolvedValue({ success: true, data: {} }),
    refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 0 }),
    detectRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),

    // Demo mode
    enterDemoMode: vi.fn().mockResolvedValue({ success: true }),
    exitDemoMode: vi.fn().mockResolvedValue({ success: true }),
    isDemoMode: vi.fn().mockResolvedValue(false),
    updateBaseDescription: vi.fn().mockResolvedValue({ success: true }),
    updateBaseTags: vi.fn().mockResolvedValue({ success: true }),
    updateRelationship: vi.fn().mockResolvedValue({ success: true }),
    archiveBase: vi.fn().mockResolvedValue({ success: true }),
    unarchiveBase: vi.fn().mockResolvedValue({ success: true }),
    classifyBases: vi.fn().mockResolvedValue({ success: true, data: [] }),

    // Tags
    getAllTags: vi.fn().mockResolvedValue({ success: true, data: [] }),
    renameTag: vi.fn().mockResolvedValue({ success: true }),
    deleteTag: vi.fn().mockResolvedValue({ success: true }),

    // Snapshots / history
    getSnapshots: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAllSnapshots: vi.fn().mockResolvedValue({ success: true, data: [] }),
    compareSnapshots: vi.fn().mockResolvedValue({ success: true, data: null }),

    // Impact / circular deps
    getImpactReport: vi.fn().mockResolvedValue({
      success: true,
      data: {
        baseId: null,
        upstream: [],
        downstream: [],
        criticalityScore: 0,
        isHub: false,
        isLeaf: true,
        totalAffected: 0,
      },
    }),
    detectCircularDeps: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getHealthStats: vi.fn().mockResolvedValue({ success: true, data: {} }),

    // Backups
    backupNow: vi.fn().mockResolvedValue({ success: true, data: { results: [] } }),
    getBackupOverview: vi
      .fn()
      .mockResolvedValue({ success: true, data: { folder: '', isRunning: false, bases: [] } }),
    getRestorePoints: vi.fn().mockResolvedValue({ success: true, data: [] }),

    // Search
    searchSchemas: vi.fn().mockResolvedValue({ success: true, data: [] }),

    // Sync metadata
    getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    setLastSync: vi.fn().mockResolvedValue({ success: true }),
    clearData: vi.fn().mockResolvedValue({ success: true }),

    // Settings / schedule / AI
    getAllSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    setSetting: vi.fn().mockResolvedValue({ success: true }),
    getNamingConvention: vi
      .fn()
      .mockResolvedValue({ enabled: false, prefix: '', label: 'Matches convention' }),
    setNamingConvention: vi.fn().mockResolvedValue({ success: true }),
    getRefreshSchedule: vi.fn().mockResolvedValue({ success: true, data: 'off' }),
    setRefreshSchedule: vi.fn().mockResolvedValue({ success: true }),
    getAiKey: vi.fn().mockResolvedValue({ hasKey: false, last4: null }),
    setAiKey: vi.fn().mockResolvedValue({ success: true }),
    testAiKey: vi.fn().mockResolvedValue({ success: true }),
    analyzeBase: vi.fn().mockResolvedValue({ success: true, data: {} }),
    analyzeWorkspace: vi.fn().mockResolvedValue({ success: true, data: {} }),
    generateDocumentation: vi.fn().mockResolvedValue({ success: true, data: '' }),

    // Export
    exportInventoryCsv: vi.fn().mockResolvedValue({ success: true, data: '' }),
    exportInventoryJson: vi.fn().mockResolvedValue({ success: true, data: '' }),
    exportMarkdown: vi.fn().mockResolvedValue({ success: true, data: '' }),
    exportMermaid: vi.fn().mockResolvedValue({ success: true, data: '' }),
    saveFile: vi.fn().mockResolvedValue({ success: true }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),

    // Event subscriptions — return a no-op unsubscribe
    onSyncProgress: vi.fn().mockReturnValue(() => {}),
    onScheduledRefreshStarted: vi.fn().mockReturnValue(() => {}),
    onScheduledRefreshCompleted: vi.fn().mockReturnValue(() => {}),
    onBackupProgress: vi.fn().mockReturnValue(() => {}),

    ...overrides,
  };
}

// Setup mock api on window
export function setupMockApi(overrides = {}) {
  const mockApi = createMockApi(overrides);
  window.api = mockApi;
  return mockApi;
}
