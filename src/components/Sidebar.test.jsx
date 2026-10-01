import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createContext, useContext, useState } from 'react';
import { Sidebar } from './Sidebar';
import { mockBases, mockRelationships, setupMockApi } from '../test/mocks';

// Create a mock context for more control in tests
const MockAppContext = createContext();

function MockAppProvider({ children, initialState = {} }) {
  const defaultState = {
    bases: mockBases,
    relationships: mockRelationships,
    selectedBase: null,
    allTags: [],
    showArchived: false,
    namingConvention: { enabled: true, prefix: 'v2', label: 'V2' },
    ...initialState,
  };

  const [state, setState] = useState(defaultState);
  const selectBase = vi.fn((base) => setState((s) => ({ ...s, selectedBase: base })));
  const toggleShowArchived = vi.fn(() => setState((s) => ({ ...s, showArchived: !s.showArchived })));

  return (
    <MockAppContext.Provider value={{ ...state, selectBase, toggleShowArchived }}>
      {children}
    </MockAppContext.Provider>
  );
}

// Mock the useAppContext hook
vi.mock('../context/AppContext', () => ({
  useAppContext: () => useContext(MockAppContext),
  AppProvider: ({ children }) => children,
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMockApi();
  });

  it('renders search input', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );
    expect(screen.getByPlaceholderText('Search bases...')).toBeInTheDocument();
  });

  it('renders filter buttons', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );
    expect(screen.getByText('V2 only')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('displays base count', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );
    expect(screen.getByText('2 of 2 bases')).toBeInTheDocument();
  });

  it('shows "No bases found" when list is empty', () => {
    render(
      <MockAppProvider initialState={{ bases: [], relationships: [] }}>
        <Sidebar />
      </MockAppProvider>,
    );
    expect(screen.getByText('No bases found')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 bases')).toBeInTheDocument();
  });

  it('toggles naming convention filter when clicked', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    const conventionButton = screen.getByText('V2 only');
    expect(conventionButton.className).not.toContain('bg-accent');

    await user.click(conventionButton);
    expect(conventionButton.className).toContain('bg-accent');

    await user.click(conventionButton);
    expect(conventionButton.className).not.toContain('bg-accent');
  });

  it('hides the naming convention filter button when the convention is disabled', () => {
    render(
      <MockAppProvider initialState={{ namingConvention: { enabled: false, prefix: 'v2', label: 'V2' } }}>
        <Sidebar />
      </MockAppProvider>,
    );

    expect(screen.queryByText('V2 only')).not.toBeInTheDocument();
  });

  it('toggles Connected filter when clicked', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    const connectedButton = screen.getByText('Connected');
    expect(connectedButton.className).not.toContain('bg-accent');

    await user.click(connectedButton);
    expect(connectedButton.className).toContain('bg-accent');
  });

  it('filters bases by search query', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    // Both bases should be visible initially
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
    expect(screen.getByText('Legacy Base')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search bases...');
    await user.type(searchInput, 'V2');

    // Only the V2 base should be visible
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Base')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 bases')).toBeInTheDocument();
  });

  it('filters bases by naming convention status', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    await user.click(screen.getByText('V2 only'));

    // Only the base matching the naming convention should be visible
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Base')).not.toBeInTheDocument();
  });

  it('filters bases by connection status', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    await user.click(screen.getByText('Connected'));

    // Only connected bases should be visible (both have connections in mock data)
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
    expect(screen.getByText('Legacy Base')).toBeInTheDocument();
  });

  it('shows no bases when connected filter is active and no connections exist', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider initialState={{ bases: mockBases, relationships: [] }}>
        <Sidebar />
      </MockAppProvider>,
    );

    await user.click(screen.getByText('Connected'));

    expect(screen.getByText('No bases found')).toBeInTheDocument();
    expect(screen.getByText('0 of 2 bases')).toBeInTheDocument();
  });

  it('combines filters correctly', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    // Apply both filters
    await user.click(screen.getByText('V2 only'));
    await user.click(screen.getByText('Connected'));

    // Only the convention-matching base with connections should be visible
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Base')).not.toBeInTheDocument();
  });

  it('displays table count for each base', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    expect(screen.getByText('5 tables')).toBeInTheDocument();
    expect(screen.getByText('3 tables')).toBeInTheDocument();
  });

  it('displays 0 tables when tableCount is null', () => {
    const basesWithNoTables = [{ ...mockBases[0], tableCount: null }];
    render(
      <MockAppProvider initialState={{ bases: basesWithNoTables, relationships: [] }}>
        <Sidebar />
      </MockAppProvider>,
    );

    expect(screen.getByText('0 tables')).toBeInTheDocument();
  });

  it('displays connection count for connected bases', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    // Both bases are connected (one outgoing, one incoming); the noun is singular for 1
    const connectionTexts = screen.getAllByText('1 connection');
    expect(connectionTexts.length).toBe(2);
  });

  it('does not display connection count for unconnected bases', () => {
    render(
      <MockAppProvider initialState={{ bases: mockBases, relationships: [] }}>
        <Sidebar />
      </MockAppProvider>,
    );

    expect(screen.queryByText(/connection/)).not.toBeInTheDocument();
  });

  it('never renders a stray 0 for zero counts or SQLite 0/1 flags', () => {
    const basesWithZeroFlags = mockBases.map((b) => ({ ...b, isArchived: 0 }));
    const { container } = render(
      <MockAppProvider initialState={{ bases: basesWithZeroFlags, relationships: [] }}>
        <Sidebar />
      </MockAppProvider>,
    );

    // `{flag && <X />}` with flag === 0 would print "0" right after the permission badge
    expect(container.textContent).not.toMatch(/(Creator|Editor)0/);
    expect(screen.queryByText('archived')).not.toBeInTheDocument();
  });

  it('selects base when clicked', async () => {
    const user = userEvent.setup();
    const mockSelectBase = vi.fn();

    // Create a custom provider with selectBase spy
    const TestProvider = ({ children }) => {
      return (
        <MockAppContext.Provider
          value={{
            bases: mockBases,
            relationships: mockRelationships,
            selectedBase: null,
            selectBase: mockSelectBase,
            allTags: [],
            showArchived: false,
            toggleShowArchived: vi.fn(),
          }}
        >
          {children}
        </MockAppContext.Provider>
      );
    };

    render(
      <TestProvider>
        <Sidebar />
      </TestProvider>,
    );

    await user.click(screen.getByText('V2 - Test Base'));

    expect(mockSelectBase).toHaveBeenCalledWith(mockBases[0]);
  });

  it('highlights selected base', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <Sidebar />
      </MockAppProvider>,
    );

    // Selected base row (the wrapping <div> around the base button) should have the
    // selected styling — the highlight classes live on that row container, not the button.
    const row = screen.getByText('V2 - Test Base').closest('.group');
    expect(row?.className).toContain('bg-accent/20');
    expect(row?.className).toContain('border-accent');
  });

  // Sidebar rows no longer render a colored bg-nodeMatch/bg-nodeOther dot per base —
  // that naming-convention distinction moved to the "V2 only" filter, WorkspaceMap legend,
  // and BaseSchemaMap. Each row now renders a BaseThumbnail avatar (identified by its title
  // attribute, which is the base name) regardless of naming convention status.
  it('shows a thumbnail for a base that matches the naming convention', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    expect(document.querySelector('[title="V2 - Test Base"]')).toBeInTheDocument();
  });

  it('shows a thumbnail for a base that does not match the naming convention', () => {
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    expect(document.querySelector('[title="Legacy Base"]')).toBeInTheDocument();
  });

  it('search is case insensitive', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    const searchInput = screen.getByPlaceholderText('Search bases...');
    await user.type(searchInput, 'legacy');

    expect(screen.getByText('Legacy Base')).toBeInTheDocument();
    expect(screen.queryByText('V2 - Test Base')).not.toBeInTheDocument();
  });

  it('clears search when input is cleared', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider>
        <Sidebar />
      </MockAppProvider>,
    );

    const searchInput = screen.getByPlaceholderText('Search bases...');
    await user.type(searchInput, 'V2');
    expect(screen.getByText('1 of 2 bases')).toBeInTheDocument();

    await user.clear(searchInput);
    expect(screen.getByText('2 of 2 bases')).toBeInTheDocument();
  });

  it('calculates connection counts correctly for bidirectional relationships', () => {
    const bidirectionalRelationships = [
      { id: 1, sourceBaseId: 'app123', targetBaseId: 'app456' },
      { id: 2, sourceBaseId: 'app456', targetBaseId: 'app123' },
    ];

    render(
      <MockAppProvider
        initialState={{
          bases: mockBases,
          relationships: bidirectionalRelationships,
        }}
      >
        <Sidebar />
      </MockAppProvider>,
    );

    // Each base should have 2 connections (one outgoing, one incoming)
    const connectionTexts = screen.getAllByText('2 connections');
    expect(connectionTexts.length).toBe(2);
  });
});
