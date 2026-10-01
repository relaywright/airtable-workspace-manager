import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useAppContext } from './AppContext';
import { setupMockApi, mockBases, mockRelationships } from '../test/mocks';

// Test component that uses the context
function TestConsumer({ onMount } = {}) {
  const context = useAppContext();
  const {
    bases,
    relationships,
    selectedBase,
    isLoading,
    error,
    hasToken,
    showSetupModal,
    lastSync,
    selectBase,
    clearSelection,
    setShowSetupModal,
    refreshBases,
    refreshSchemas,
    updateBaseDescription,
    checkToken,
    setError,
    setHasToken,
  } = context;

  // Hand the latest context value to the test (re-reported whenever the context changes)
  React.useEffect(() => {
    if (onMount) onMount(context);
  }, [onMount, context]);

  return (
    <div>
      <div data-testid="bases-count">{bases.length}</div>
      <div data-testid="relationships-count">{relationships.length}</div>
      <div data-testid="selected-base">{selectedBase?.name || 'none'}</div>
      <div data-testid="selected-base-description">{selectedBase?.userDescription || 'no-description'}</div>
      <div data-testid="is-loading">{isLoading.toString()}</div>
      <div data-testid="error">{error || 'none'}</div>
      <div data-testid="has-token">{hasToken.toString()}</div>
      <div data-testid="show-setup-modal">{showSetupModal.toString()}</div>
      <div data-testid="last-sync">{lastSync || 'none'}</div>
      <button onClick={() => selectBase({ id: 'test', name: 'Test Base' })}>Select Base</button>
      <button onClick={() => selectBase({ id: 'app123', name: 'Selected For Update', userDescription: '' })}>
        Select Base For Update
      </button>
      <button onClick={clearSelection}>Clear Selection</button>
      <button onClick={() => setShowSetupModal(true)}>Show Modal</button>
      <button onClick={() => setShowSetupModal(false)}>Hide Modal</button>
      <button onClick={refreshBases}>Refresh Bases</button>
      <button onClick={refreshSchemas}>Refresh Schemas</button>
      <button onClick={() => updateBaseDescription('test', 'New description')}>Update Description</button>
      <button onClick={() => updateBaseDescription('app123', 'Updated desc')}>
        Update Selected Description
      </button>
      <button onClick={checkToken}>Check Token</button>
      <button onClick={() => setError('Custom error')}>Set Error</button>
      <button onClick={() => setError(null)}>Clear Error</button>
      <button onClick={() => setHasToken(true)}>Set Has Token</button>
    </div>
  );
}

import React from 'react';

describe('AppContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useAppContext must be used within an AppProvider');

    consoleSpy.mockRestore();
  });

  it('provides default values', async () => {
    setupMockApi();
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    expect(screen.getByTestId('bases-count')).toHaveTextContent('0');
    expect(screen.getByTestId('relationships-count')).toHaveTextContent('0');
    expect(screen.getByTestId('selected-base')).toHaveTextContent('none');
    expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('loads accounts and the active account from successful IPC responses', async () => {
    setupMockApi({
      getAccounts: vi.fn().mockResolvedValue({
        success: true,
        data: [
          { id: '1', name: 'Cedar & Pine' },
          { id: '2', name: 'Second workspace' },
        ],
      }),
      getActiveAccount: vi.fn().mockResolvedValue({
        success: true,
        data: { id: '1', name: 'Cedar & Pine' },
      }),
    });
    let contextValue;
    render(
      <AppProvider>
        <TestConsumer
          onMount={(ctx) => {
            contextValue = ctx;
          }}
        />
      </AppProvider>,
    );

    await act(async () => {
      await contextValue.loadAccounts();
    });

    expect(contextValue.accounts).toHaveLength(2);
    expect(contextValue.activeAccount.id).toBe('1');
  });

  it('selectBase updates selectedBase', async () => {
    const user = userEvent.setup();
    setupMockApi();
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await user.click(screen.getByText('Select Base'));
    expect(screen.getByTestId('selected-base')).toHaveTextContent('Test Base');
  });

  it('clearSelection clears selectedBase', async () => {
    const user = userEvent.setup();
    setupMockApi();
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await user.click(screen.getByText('Select Base'));
    expect(screen.getByTestId('selected-base')).toHaveTextContent('Test Base');

    await user.click(screen.getByText('Clear Selection'));
    expect(screen.getByTestId('selected-base')).toHaveTextContent('none');
  });

  it('setShowSetupModal updates modal state', async () => {
    const user = userEvent.setup();
    setupMockApi();
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    expect(screen.getByTestId('show-setup-modal')).toHaveTextContent('false');
    await user.click(screen.getByText('Show Modal'));
    expect(screen.getByTestId('show-setup-modal')).toHaveTextContent('true');
    await user.click(screen.getByText('Hide Modal'));
    expect(screen.getByTestId('show-setup-modal')).toHaveTextContent('false');
  });

  it('setError updates error state', async () => {
    const user = userEvent.setup();
    setupMockApi();
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await user.click(screen.getByText('Set Error'));
    expect(screen.getByTestId('error')).toHaveTextContent('Custom error');
    await user.click(screen.getByText('Clear Error'));
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('setHasToken updates hasToken state', async () => {
    const user = userEvent.setup();
    setupMockApi();
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await user.click(screen.getByText('Set Has Token'));
    expect(screen.getByTestId('has-token')).toHaveTextContent('true');
  });

  it('refreshBases fetches and updates bases', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Refresh Bases'));
    });

    await waitFor(() => {
      expect(mockApi.fetchAllBases).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockApi.setLastSync).toHaveBeenCalled();
    });
  });

  it('refreshBases sets loading state', async () => {
    const user = userEvent.setup();
    let resolvePromise;
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      fetchAllBases: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
      ),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    expect(screen.getByTestId('is-loading')).toHaveTextContent('false');

    user.click(screen.getByText('Refresh Bases'));

    await waitFor(() => {
      expect(screen.getByTestId('is-loading')).toHaveTextContent('true');
    });

    // Resolve the promise to complete the refresh
    resolvePromise({ success: true, data: [] });

    await waitFor(() => {
      expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
    });
  });

  it('refreshBases sets error on failure', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: false, error: 'API Error' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Refresh Bases'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('API Error');
    });
  });

  it('refreshSchemas updates bases with schemas', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 2 }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: mockRelationships }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Refresh Schemas'));
    });

    await waitFor(() => {
      expect(mockApi.refreshSchemas).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockApi.getBases).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockApi.getRelationships).toHaveBeenCalled();
    });
  });

  it('refreshSchemas sets error on failure', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: false, error: 'Schema Error' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Refresh Schemas'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Schema Error');
    });

    consoleSpy.mockRestore();
  });

  it('refreshSchemas returns result object', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 5 }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: mockRelationships }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    let contextValue;
    render(
      <AppProvider>
        <TestConsumer
          onMount={(ctx) => {
            contextValue = ctx;
          }}
        />
      </AppProvider>,
    );

    let result;
    await act(async () => {
      result = await contextValue.refreshSchemas();
    });

    expect(result).toEqual({ success: true, basesUpdated: 5 });
  });

  it('updateBaseDescription calls API', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      updateBaseDescription: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Update Description'));
    });

    await waitFor(() => {
      expect(mockApi.updateBaseDescription).toHaveBeenCalledWith('test', 'New description');
    });
  });

  it('updateBaseDescription updates local state for selected base', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      updateBaseDescription: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    // First select a base
    await user.click(screen.getByText('Select Base For Update'));
    expect(screen.getByTestId('selected-base')).toHaveTextContent('Selected For Update');

    // Update description for the selected base
    await act(async () => {
      await user.click(screen.getByText('Update Selected Description'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-base-description')).toHaveTextContent('Updated desc');
    });
  });

  it('updateBaseDescription handles API error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      updateBaseDescription: vi.fn().mockRejectedValue(new Error('Update failed')),
    });

    let contextValue;
    render(
      <AppProvider>
        <TestConsumer
          onMount={(ctx) => {
            contextValue = ctx;
          }}
        />
      </AppProvider>,
    );

    let result;
    await act(async () => {
      result = await contextValue.updateBaseDescription('test', 'desc');
    });

    expect(result).toEqual({ success: false, error: 'Update failed' });
    consoleSpy.mockRestore();
  });

  it('checkToken loads data when token exists', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: mockRelationships }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: '2024-01-01T00:00:00Z' }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Check Token'));
    });

    await waitFor(() => {
      expect(mockApi.getBases).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockApi.getRelationships).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId('has-token')).toHaveTextContent('true');
    });

    await waitFor(() => {
      expect(screen.getByTestId('last-sync')).toHaveTextContent('2024-01-01T00:00:00Z');
    });
  });

  it('checkToken shows setup modal when no token', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Check Token'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('show-setup-modal')).toHaveTextContent('true');
    });

    await waitFor(() => {
      expect(screen.getByTestId('has-token')).toHaveTextContent('false');
    });
  });

  it('checkToken loads bases and skips the setup modal when demo mode is active but there is no token', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
      isDemoMode: vi.fn().mockResolvedValue(true),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Check Token'));
    });

    await waitFor(() => {
      expect(mockApi.getBases).toHaveBeenCalled();
    });

    expect(screen.getByTestId('show-setup-modal')).toHaveTextContent('false');
  });

  it('checkToken handles errors', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      getToken: vi.fn().mockRejectedValue(new Error('Token check failed')),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Check Token'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Token check failed');
    });

    consoleSpy.mockRestore();
  });

  it('updates bases state correctly from database', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Refresh Bases'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('bases-count')).toHaveTextContent('2');
    });
  });

  it('updates relationships state from database', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 0 }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: mockRelationships }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>,
    );

    await act(async () => {
      await user.click(screen.getByText('Refresh Schemas'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('relationships-count')).toHaveTextContent('1');
    });
  });
});
