import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupModal } from './SetupModal';
import { AppProvider } from '../context/AppContext';
import { setupMockApi } from '../test/mocks';

const mockOnClose = vi.fn();

// SetupModal kicks off six independent async effects on mount (loadExistingToken,
// loadLastSync, loadDetectionSettings, loadRefreshSchedule, loadAiKey,
// loadNamingConvention). An `await act(async () => { render(...) })` on its own
// only awaits the callback itself, which returns as soon as render() returns
// (render isn't async), so it doesn't reliably wait for six independently
// resolving mocked promises to settle. Yielding a real macrotask tick
// (setTimeout) inside the act callback lets every already-queued microtask
// (every mocked promise's .then, and the setState calls they make) drain
// before act returns control to the test, so React never sees one of those
// state updates land outside of act.
function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderSetupModal(onClose = mockOnClose) {
  let utils;
  await act(async () => {
    utils = render(
      <AppProvider>
        <SetupModal onClose={onClose} />
      </AppProvider>,
    );
    await flushMicrotasks();
  });
  return utils;
}

describe('SetupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders modal with title', async () => {
    await renderSetupModal();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders token input field', async () => {
    await renderSetupModal();
    expect(screen.getByPlaceholderText('pat...')).toBeInTheDocument();
  });

  it('renders Test Connection button', async () => {
    await renderSetupModal();
    expect(screen.getByText('Test Connection')).toBeInTheDocument();
  });

  it('renders Save button', async () => {
    await renderSetupModal();
    expect(screen.getByText('Save & Fetch Bases')).toBeInTheDocument();
  });

  it('renders Cancel button', async () => {
    await renderSetupModal();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    await renderSetupModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', async () => {
    await renderSetupModal();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', async () => {
    await renderSetupModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    await renderSetupModal();

    const input = screen.getByPlaceholderText('pat...');
    expect(input).toHaveAttribute('type', 'password');

    // Scope the Show/Hide toggle to this input's container (there's also an AI-key toggle on the page)
    const toggleButton = () => input.parentElement.querySelector('button');

    await user.click(toggleButton());
    expect(input).toHaveAttribute('type', 'text');

    await user.click(toggleButton());
    expect(input).toHaveAttribute('type', 'password');
  });

  it('disables test connection button when token is empty', async () => {
    await renderSetupModal();

    const testButton = screen.getByText('Test Connection');
    expect(testButton).toBeDisabled();
  });

  it('disables save button when token is empty', async () => {
    await renderSetupModal();

    const saveButton = screen.getByText('Save & Fetch Bases');
    expect(saveButton).toBeDisabled();
  });

  it('enables test button when token is entered', async () => {
    const user = userEvent.setup();
    await renderSetupModal();

    const input = screen.getByPlaceholderText('pat...');
    await user.type(input, 'test-token');

    const testButton = screen.getByText('Test Connection');
    expect(testButton).not.toBeDisabled();
  });

  it('enables save button when token is entered', async () => {
    const user = userEvent.setup();
    await renderSetupModal();

    const input = screen.getByPlaceholderText('pat...');
    await user.type(input, 'test-token');

    const saveButton = screen.getByText('Save & Fetch Bases');
    expect(saveButton).not.toBeDisabled();
  });

  it('tests connection with valid token', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    const input = screen.getByPlaceholderText('pat...');
    await user.type(input, 'test-token');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(mockApi.testConnection).toHaveBeenCalledWith('test-token');
    });
  });

  it('shows success message on successful connection test', async () => {
    const user = userEvent.setup();
    setupMockApi({
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'test-token');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(screen.getByText('Connection successful!')).toBeInTheDocument();
    });
  });

  it('warns when a connected token cannot see any bases', async () => {
    const user = userEvent.setup();
    setupMockApi({
      testConnection: vi.fn().mockResolvedValue({ success: true, baseCount: 0 }),
    });

    await renderSetupModal();
    await user.type(screen.getByPlaceholderText('pat...'), 'patNewGood.0123456789abcdef');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    expect(
      await screen.findByText(
        "Connected, but this token can't see any bases yet. On Airtable's token page, edit the token and add your workspace under Access.",
      ),
    ).toHaveClass('text-warning');
    expect(screen.queryByText('Connection successful!')).not.toBeInTheDocument();
  });

  it('shows error message on failed connection test', async () => {
    const user = userEvent.setup();
    setupMockApi({
      testConnection: vi.fn().mockResolvedValue({
        success: false,
        error: 'Invalid token',
      }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'bad-token');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(screen.getByText('Invalid token')).toBeInTheDocument();
    });
  });

  it('shows "Connection failed" when test fails without error message', async () => {
    const user = userEvent.setup();
    setupMockApi({
      testConnection: vi.fn().mockResolvedValue({ success: false }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'bad-token');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });
  });

  it('shows Testing... while testing connection', async () => {
    const user = userEvent.setup();
    let resolveTest;
    setupMockApi({
      testConnection: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveTest = resolve;
          }),
      ),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'test-token');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(screen.getByText('Testing...')).toBeInTheDocument();
    });

    // Resolving the pending mock lets handleTestConnection's finally block run
    // (setTestResult, setIsTesting(false)); act() flushes that update before
    // the test ends instead of leaving it to land after cleanup.
    await act(async () => {
      resolveTest({ success: true });
    });
  });

  it('saves token and closes modal on successful save', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      setToken: vi.fn().mockResolvedValue({ success: true }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'valid-token');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(mockApi.setToken).toHaveBeenCalledWith('valid-token');
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('stays open with a warning when the saved token cannot see any bases', async () => {
    const user = userEvent.setup();
    setupMockApi({
      setToken: vi.fn().mockResolvedValue({ success: true, baseCount: 0 }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'patDemoToken.0123456789abcdef');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(screen.getByText(/this token can't see any bases yet/)).toBeInTheDocument();
    });
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('shows error when save fails', async () => {
    const user = userEvent.setup();
    setupMockApi({
      setToken: vi.fn().mockResolvedValue({ success: false, error: 'Save failed' }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'valid-token');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeInTheDocument();
    });
  });

  it('shows "Failed to save token" when save fails without error message', async () => {
    const user = userEvent.setup();
    setupMockApi({
      setToken: vi.fn().mockResolvedValue({ success: false }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'valid-token');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to save token')).toBeInTheDocument();
    });
  });

  it('shows Saving... while saving', async () => {
    const user = userEvent.setup();
    let resolveSave;
    setupMockApi({
      setToken: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      ),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'test-token');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    // Resolving the pending mock lets handleSave's rest (setHasToken,
    // refreshBases, onClose, the finally's setIsLoading(false)) run; act()
    // flushes that whole chain before the test ends.
    await act(async () => {
      resolveSave({ success: true });
    });
  });

  it('handles save exception', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      setToken: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'test-token');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('handles test connection exception', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      testConnection: vi.fn().mockRejectedValue(new Error('Connection error')),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), 'test-token');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(screen.getByText('Connection error')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders clear data button', async () => {
    await renderSetupModal();
    expect(screen.getByText('Clear all local data')).toBeInTheDocument();
  });

  it('clears data when clear button is clicked and confirmed', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      clearData: vi.fn().mockResolvedValue({ success: true }),
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });
    window.confirm = vi.fn().mockReturnValue(true);

    await renderSetupModal();

    await act(async () => {
      await user.click(screen.getByText('Clear all local data'));
    });

    await waitFor(() => {
      expect(mockApi.clearData).toHaveBeenCalled();
    });
  });

  it('does not clear data when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      clearData: vi.fn().mockResolvedValue({ success: true }),
    });
    window.confirm = vi.fn().mockReturnValue(false);

    await renderSetupModal();

    await act(async () => {
      await user.click(screen.getByText('Clear all local data'));
    });

    expect(mockApi.clearData).not.toHaveBeenCalled();
  });

  it('handles clear data exception', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      clearData: vi.fn().mockRejectedValue(new Error('Clear failed')),
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
    });
    window.confirm = vi.fn().mockReturnValue(true);

    await renderSetupModal();

    await act(async () => {
      await user.click(screen.getByText('Clear all local data'));
    });

    await waitFor(() => {
      expect(screen.getByText('Clear failed')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('renders link to Airtable tokens page', async () => {
    await renderSetupModal();
    const link = screen.getByRole('link', { name: /airtable.com\/create\/tokens/i });
    expect(link).toHaveAttribute('href', 'https://airtable.com/create/tokens');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows saved secrets masked and tests the saved token without sending it', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'abcd' }),
      getAiKey: vi.fn().mockResolvedValue({ hasKey: true, last4: 'wxyz' }),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    expect(await screen.findByLabelText('Saved token')).toHaveTextContent('••••••••abcd');
    expect(screen.getByLabelText('Saved Anthropic API key')).toHaveTextContent('••••••••wxyz');
    expect(screen.queryByPlaceholderText('pat...')).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });
    await waitFor(() => {
      expect(mockApi.testConnection).toHaveBeenCalledWith();
    });
  });

  it('activates the saved token before fetching bases when no replacement is typed', async () => {
    const user = userEvent.setup();
    let resolveActivation;
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'abcd' }),
      setToken: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveActivation = resolve;
          }),
      ),
    });

    render(
      <AppProvider>
        <SetupModal onClose={mockOnClose} />
      </AppProvider>,
    );

    await screen.findByLabelText('Saved token');
    await user.click(screen.getByRole('button', { name: 'Save & Fetch Bases' }));
    expect(mockApi.setToken).toHaveBeenCalledWith();
    expect(mockApi.fetchAllBases).not.toHaveBeenCalled();

    resolveActivation({ success: true });
    await waitFor(() => {
      expect(mockApi.fetchAllBases).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('removes the saved Anthropic key after confirmation', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getAiKey: vi
        .fn()
        .mockResolvedValueOnce({ hasKey: true, last4: 'wxyz' })
        .mockResolvedValue({ hasKey: false, last4: null }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <AppProvider>
        <SetupModal onClose={mockOnClose} />
      </AppProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Remove key' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Remove the saved Anthropic API key? AI features will be turned off until you add a key again.',
    );
    expect(mockApi.setAiKey).toHaveBeenCalledWith('');
    expect(await screen.findByText('Key removed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Saved Anthropic API key')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-ant-...')).toHaveValue('');
  });

  it('replaces a saved token with a newly typed one', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: true, last4: 'abcd' }),
      setToken: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await screen.findByLabelText('Saved token');
    await user.click(screen.getAllByText('Replace')[0]);
    await user.type(screen.getByPlaceholderText('pat...'), 'new-token');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(mockApi.setToken).toHaveBeenCalledWith('new-token');
    });
  });

  it('displays last sync time when available', async () => {
    const testDate = '2024-01-15T10:30:00Z';
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: testDate }),
    });

    await renderSetupModal();

    await waitFor(() => {
      expect(screen.getByText(/Last sync:/)).toBeInTheDocument();
    });
  });

  it('does not display last sync when null', async () => {
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    await renderSetupModal();

    await waitFor(() => {
      expect(screen.queryByText(/Last sync:/)).not.toBeInTheDocument();
    });
  });

  it('handles load token error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      getToken: vi.fn().mockRejectedValue(new Error('Load error')),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
    });

    await renderSetupModal();

    // Should not crash
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('handles load last sync error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMockApi({
      getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
      getLastSync: vi.fn().mockRejectedValue(new Error('Load error')),
    });

    await renderSetupModal();

    // Should not crash
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('trims whitespace from token before testing', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), '  test-token  ');
    await act(async () => {
      await user.click(screen.getByText('Test Connection'));
    });

    await waitFor(() => {
      expect(mockApi.testConnection).toHaveBeenCalledWith('test-token');
    });
  });

  it('trims whitespace from token before saving', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      setToken: vi.fn().mockResolvedValue({ success: true }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await user.type(screen.getByPlaceholderText('pat...'), '  trimmed-token  ');
    await act(async () => {
      await user.click(screen.getByText('Save & Fetch Bases'));
    });

    await waitFor(() => {
      expect(mockApi.setToken).toHaveBeenCalledWith('trimmed-token');
    });
  });

  it('keeps the add-account form open with an inline error and token help link after rejection', async () => {
    const user = userEvent.setup();
    const error = "Airtable didn't accept this token. Check that you copied the whole token.";
    const helpUrl = 'https://airtable.com/create/tokens';
    const mockApi = setupMockApi({
      addAccount: vi.fn().mockResolvedValue({ success: false, error, helpUrl }),
    });

    await renderSetupModal();
    await user.click(screen.getByRole('button', { name: '+ Add Account' }));
    const nameInput = screen.getByPlaceholderText('e.g. Work, Personal');
    const form = within(nameInput.parentElement.parentElement);
    await user.type(nameInput, 'Cedar & Pine Goods');
    await user.type(form.getByPlaceholderText('pat...'), 'patNewBad.fedcba9876543210');
    await act(async () => {
      await user.click(form.getByRole('button', { name: 'Add Account' }));
    });

    expect(await form.findByText(error)).toBeInTheDocument();
    const link = form.getByRole('link', { name: "Open Airtable's token page" });
    expect(link).toHaveAttribute('href', helpUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(nameInput).toHaveValue('Cedar & Pine Goods');
    expect(form.getByPlaceholderText('pat...')).toHaveValue('patNewBad.fedcba9876543210');
    expect(form.getByRole('button', { name: 'Add Account' })).toBeEnabled();
    expect(mockApi.addAccount).toHaveBeenCalledWith('Cedar & Pine Goods', 'patNewBad.fedcba9876543210');
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('calls window.api.enterDemoMode when Try with sample data is clicked', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi({
      enterDemoMode: vi.fn().mockResolvedValue({ success: true }),
    });

    await renderSetupModal();

    await act(async () => {
      await user.click(screen.getByText('Try with sample data'));
    });

    await waitFor(() => {
      expect(mockApi.enterDemoMode).toHaveBeenCalledTimes(1);
    });
  });
});
