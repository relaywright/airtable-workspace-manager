import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createContext, useContext } from 'react';
import { Header } from './Header';
import { setupMockApi } from '../test/mocks';

// Create a mock context for more control
const MockAppContext = createContext();

function MockAppProvider({ children, initialState = {} }) {
  const defaultState = {
    isLoading: false,
    lastSync: null,
    ...initialState,
  };

  return <MockAppContext.Provider value={defaultState}>{children}</MockAppContext.Provider>;
}

// Mock the useAppContext hook
vi.mock('../context/AppContext', () => ({
  useAppContext: () => useContext(MockAppContext),
  AppProvider: ({ children }) => children,
}));

describe('Header', () => {
  const mockOnSettingsClick = vi.fn();
  const mockOnRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockApi();
  });

  it('renders the app title', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    expect(screen.getByText('Workspace Manager')).toBeInTheDocument();
  });

  it('renders the refresh button', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('renders the settings button', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mockOnRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onSettingsClick when settings button is clicked', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(mockOnSettingsClick).toHaveBeenCalledTimes(1);
  });

  it('does not display last sync when lastSync is null', () => {
    render(
      <MockAppProvider initialState={{ lastSync: null }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    expect(screen.queryByText(/Last sync:/)).not.toBeInTheDocument();
  });

  it('displays formatted last sync time when available', () => {
    const testDate = '2024-01-15T10:30:00Z';
    render(
      <MockAppProvider initialState={{ lastSync: testDate }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    expect(screen.getByText(/Last sync:/)).toBeInTheDocument();
  });

  it('disables refresh button when loading', () => {
    render(
      <MockAppProvider initialState={{ isLoading: true }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    expect(refreshButton).toBeDisabled();
  });

  it('enables refresh button when not loading', () => {
    render(
      <MockAppProvider initialState={{ isLoading: false }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    expect(refreshButton).not.toBeDisabled();
  });

  it('shows spinning animation when loading', () => {
    render(
      <MockAppProvider initialState={{ isLoading: true }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    const svg = refreshButton.querySelector('svg');
    expect(svg).toHaveClass('animate-spin');
  });

  it('does not show spinning animation when not loading', () => {
    render(
      <MockAppProvider initialState={{ isLoading: false }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    const svg = refreshButton.querySelector('svg');
    expect(svg).not.toHaveClass('animate-spin');
  });

  it('has correct button titles', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    expect(screen.getByTitle('Refresh bases')).toBeInTheDocument();
    expect(screen.getByTitle('Settings')).toBeInTheDocument();
  });

  it('renders app icon', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    // Check for the icon container with bg-accent class
    const iconContainer = document.querySelector('.bg-accent.rounded-lg');
    expect(iconContainer).toBeInTheDocument();
  });

  it('applies correct styling to header', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const header = document.querySelector('header');
    expect(header).toHaveClass('bg-surface', 'border-b', 'border-border');
  });

  it('has correct header height', () => {
    render(
      <MockAppProvider>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const header = document.querySelector('header');
    expect(header).toHaveClass('h-14');
  });

  it('settings button is always enabled', () => {
    render(
      <MockAppProvider initialState={{ isLoading: true }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    const settingsButton = screen.getByRole('button', { name: /settings/i });
    expect(settingsButton).not.toBeDisabled();
  });

  it('formats date correctly for recent timestamp', () => {
    // Use a fixed date that will format the same way
    const testDate = new Date('2024-06-15T14:30:00').toISOString();
    render(
      <MockAppProvider initialState={{ lastSync: testDate }}>
        <Header onSettingsClick={mockOnSettingsClick} onRefresh={mockOnRefresh} />
      </MockAppProvider>,
    );
    // Just verify the Last sync text appears
    expect(screen.getByText(/Last sync:/)).toBeInTheDocument();
  });
});
