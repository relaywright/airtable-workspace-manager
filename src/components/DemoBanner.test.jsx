import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoBanner } from './DemoBanner';
import { AppProvider } from '../context/AppContext';
import { setupMockApi } from '../test/mocks';

describe('DemoBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the sample-data copy', () => {
    render(
      <AppProvider>
        <DemoBanner />
      </AppProvider>,
    );
    expect(screen.getByText("You're viewing sample data from a fictional company.")).toBeInTheDocument();
  });

  it('renders an Exit sample data button', () => {
    render(
      <AppProvider>
        <DemoBanner />
      </AppProvider>,
    );
    expect(screen.getByText('Exit sample data')).toBeInTheDocument();
  });

  it('calls window.api.exitDemoMode when Exit sample data is clicked', async () => {
    const user = userEvent.setup();
    const mockApi = setupMockApi();

    render(
      <AppProvider>
        <DemoBanner />
      </AppProvider>,
    );

    await user.click(screen.getByText('Exit sample data'));

    await waitFor(() => {
      expect(mockApi.exitDemoMode).toHaveBeenCalledTimes(1);
    });
  });

  it('shows Exiting... while the exit call is in flight', async () => {
    const user = userEvent.setup();
    let resolveExit;
    setupMockApi({
      exitDemoMode: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveExit = resolve;
          }),
      ),
    });

    render(
      <AppProvider>
        <DemoBanner />
      </AppProvider>,
    );

    await user.click(screen.getByText('Exit sample data'));

    await waitFor(() => {
      expect(screen.getByText('Exiting...')).toBeInTheDocument();
    });

    resolveExit({ success: true });
  });
});
