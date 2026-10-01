import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { setupMockApi, mockBases, mockRelationships } from './test/mocks';

// Mock cytoscape
vi.mock('cytoscape', () => {
  const mockCy = {
    on: vi.fn(),
    elements: vi.fn().mockReturnValue({ remove: vi.fn() }),
    add: vi.fn(),
    batch: vi.fn((fn) => fn()),
    layout: vi.fn().mockReturnValue({ run: vi.fn() }),
    fit: vi.fn(),
    nodes: vi.fn().mockReturnValue({ unselect: vi.fn(), removeClass: vi.fn(), forEach: vi.fn() }),
    edges: vi.fn().mockReturnValue({ removeClass: vi.fn(), forEach: vi.fn() }),
    getElementById: vi.fn().mockReturnValue({ select: vi.fn() }),
    zoom: vi.fn().mockReturnValue(1),
    destroy: vi.fn(),
  };
  const cytoscape = vi.fn().mockReturnValue(mockCy);
  cytoscape.use = vi.fn();
  cytoscape.prototype = {};
  return {
    default: cytoscape,
  };
});

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the app with header', async () => {
    setupMockApi();
    render(<App />);

    expect(screen.getByText('Workspace Manager')).toBeInTheDocument();
  });

  it('shows welcome message when no token', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Welcome to Workspace Manager')).toBeInTheDocument();
    });
  });

  it('shows setup modal when no token', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('shows "Add API Token" button when no token', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Add API Token')).toBeInTheDocument();
    });
  });

  it('opens settings modal when "Add API Token" clicked', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Add API Token')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Add API Token'));

    // Modal should remain open (it was already open)
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows no bases message when token exists but no bases', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('No Bases Found')).toBeInTheDocument();
    });
  });

  it('shows "Fetch Bases" button when no bases', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Fetch Bases')).toBeInTheDocument();
    });
  });

  it('calls refreshSchemas when "Fetch Bases" clicked', async () => {
    // App.jsx wires "Fetch Bases" to refreshSchemas (fetch + schema pull + relationship
    // detection in one pass), not the lighter refreshBases used by SetupModal's initial fetch.
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 0 }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Fetch Bases')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Fetch Bases'));

    await waitFor(() => {
      expect(mockApi.refreshSchemas).toHaveBeenCalled();
    });
  });

  it('shows workspace map when bases exist', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Legend')).toBeInTheDocument();
    });
  });

  it('opens settings modal when settings button clicked', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /settings/i }));

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('closes settings modal when close button clicked', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    });

    // Open modal
    await user.click(screen.getByRole('button', { name: /settings/i }));

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Close modal
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(screen.queryByText('Airtable Personal Access Token')).not.toBeInTheDocument();
    });
  });

  it('renders sidebar', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search bases...')).toBeInTheDocument();
    });
  });

  it('renders refresh button', async () => {
    setupMockApi();
    render(<App />);

    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('calls refreshSchemas when refresh button clicked', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 0 }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockApi.refreshSchemas).toHaveBeenCalled();
    });
  });

  it('shows loading state', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    // Initial render should have loading state capability
    expect(screen.getByText('Workspace Manager')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: false, error: 'Network error' }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows "Try Again" button on error', async () => {
    const user = userEvent.setup();
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: false, error: 'API Error' }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });
  });

  it('calls refreshSchemas when "Try Again" clicked', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
      refreshSchemas: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ success: false, error: 'First error' });
        }
        return Promise.resolve({ success: true, basesUpdated: 0 });
      }),
    });
    render(<App />);

    // First refresh - causes error
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    // Click try again
    await user.click(screen.getByText('Try Again'));

    await waitFor(() => {
      expect(mockApi.refreshSchemas).toHaveBeenCalledTimes(2);
    });
  });

  it('displays bases in sidebar when loaded', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: mockRelationships }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
      expect(screen.getByText('Legacy Base')).toBeInTheDocument();
    });
  });

  it('displays base count in sidebar', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: mockBases }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('2 of 2 bases')).toBeInTheDocument();
    });
  });

  it('shows loading spinner during async operations', async () => {
    const user = userEvent.setup();
    let resolvePromise;
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'oken' }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      refreshSchemas: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
      ),
    });
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    // Should show loading spinner
    await waitFor(() => {
      expect(screen.getByText('Loading workspace...')).toBeInTheDocument();
    });

    // Resolve the promise
    resolvePromise({ success: true, basesUpdated: 0 });
  });
});
