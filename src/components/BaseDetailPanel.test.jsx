import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createContext, useContext, useState } from 'react';
import { mockBases, mockRelationships, setupMockApi } from '../test/mocks';
import { BaseDetailPanel } from './BaseDetailPanel';

// Create a mock context for testing with selected base
const MockAppContext = createContext();

function MockAppProvider({ children, initialState = {} }) {
  const defaultState = {
    bases: mockBases,
    relationships: mockRelationships,
    selectedBase: null,
    allTags: [],
    isLoading: false,
    error: null,
    hasToken: true,
    ...initialState,
  };

  const [state, setState] = useState(defaultState);

  const value = {
    ...state,
    selectBase: vi.fn((base) => setState((s) => ({ ...s, selectedBase: base }))),
    clearSelection: vi.fn(() => setState((s) => ({ ...s, selectedBase: null }))),
    updateBaseDescription: vi.fn().mockResolvedValue(),
    updateBaseTags: vi.fn().mockResolvedValue(),
    updateRelationship: vi.fn().mockResolvedValue(),
    archiveBase: vi.fn().mockResolvedValue(),
    unarchiveBase: vi.fn().mockResolvedValue(),
    refreshBases: vi.fn(),
    refreshSchemas: vi.fn(),
    setError: vi.fn(),
  };

  return <MockAppContext.Provider value={value}>{children}</MockAppContext.Provider>;
}

// Mock the useAppContext hook
vi.mock('../context/AppContext', () => ({
  useAppContext: () => useContext(MockAppContext),
  AppProvider: ({ children }) => children,
}));

// Selects another base through the mocked context, the way the map or sidebar would.
function SwitchBaseButton() {
  const { selectBase } = useContext(MockAppContext);
  return <button onClick={() => selectBase(mockBases[1])}>switch base</button>;
}

const renderEditablePanel = () =>
  render(
    <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
      <BaseDetailPanel />
      <SwitchBaseButton />
    </MockAppProvider>,
  );

describe('BaseDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
    setupMockApi();
  });

  describe('tag dropdown', () => {
    it('closes when clicking outside it', async () => {
      renderEditablePanel();
      await userEvent.click(screen.getByRole('button', { name: '+ Add Tag' }));
      expect(screen.getByPlaceholderText('New tag name...')).toBeInTheDocument();
      await userEvent.click(document.body);
      expect(screen.queryByPlaceholderText('New tag name...')).not.toBeInTheDocument();
    });

    it('stays open while typing in it', async () => {
      renderEditablePanel();
      await userEvent.click(screen.getByRole('button', { name: '+ Add Tag' }));
      await userEvent.type(screen.getByPlaceholderText('New tag name...'), 'Finance');
      expect(screen.getByPlaceholderText('New tag name...')).toHaveValue('Finance');
    });

    it('closes on Escape', async () => {
      renderEditablePanel();
      await userEvent.click(screen.getByRole('button', { name: '+ Add Tag' }));
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByPlaceholderText('New tag name...')).not.toBeInTheDocument();
      expect(screen.getByRole('complementary')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: mockBases[0].name })).toBeInTheDocument();
    });

    it('closes when another base is selected', async () => {
      renderEditablePanel();
      await userEvent.click(screen.getByRole('button', { name: '+ Add Tag' }));
      // fireEvent.click sends no mousedown, so this proves the base change closes it,
      // not the outside-click handler.
      act(() => {
        fireEvent.click(screen.getByText('switch base'));
      });
      expect(screen.queryByPlaceholderText('New tag name...')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: mockBases[1].name })).toBeInTheDocument();
    });
  });

  it('renders without crashing when no base selected', () => {
    const { container } = render(
      <MockAppProvider>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    // When no base is selected, nothing is rendered
    expect(container.querySelector('aside')).toBeNull();
  });

  it('renders base name when base is selected', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
  });

  it('shows the friendly permission level label', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Creator')).toBeInTheDocument();
    expect(screen.queryByText(/create access/)).toBeNull();
  });

  it('shows an unknown access note when permission level is not set', () => {
    const baseWithoutPermission = { ...mockBases[0], permissionLevel: null };
    render(
      <MockAppProvider initialState={{ selectedBase: baseWithoutPermission }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Access level unknown')).toBeInTheDocument();
  });

  it('shows table count in overview', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Tables')).toBeInTheDocument();
  });

  it('shows field count in overview', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Fields')).toBeInTheDocument();
  });

  it('shows 0 for table count when not set', () => {
    const baseWithoutCounts = { ...mockBases[0], tableCount: null, fieldCount: null };
    render(
      <MockAppProvider initialState={{ selectedBase: baseWithoutCounts }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });

  it('displays user description when present', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('A test description')).toBeInTheDocument();
  });

  it('displays "No description added." when no description', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[1] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('No description added.')).toBeInTheDocument();
  });

  it('shows Edit button for description', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    // The connections list also renders its own per-relationship "Edit" link,
    // so the description's Edit button is the first one in DOM order.
    expect(screen.getAllByText('Edit')[0]).toBeInTheDocument();
  });

  it('opens edit mode when Edit button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );

    await user.click(screen.getAllByText('Edit')[0]);

    expect(screen.getByPlaceholderText('Add a description...')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('pre-fills textarea with existing description when editing', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );

    await user.click(screen.getAllByText('Edit')[0]);

    const textarea = screen.getByPlaceholderText('Add a description...');
    expect(textarea.value).toBe('A test description');
  });

  it('cancels editing when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );

    await user.click(screen.getAllByText('Edit')[0]);
    await user.click(screen.getByText('Cancel'));

    expect(screen.queryByPlaceholderText('Add a description...')).toBeNull();
    expect(screen.getAllByText('Edit')[0]).toBeInTheDocument();
  });

  it('updates description text in textarea', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );

    await user.click(screen.getAllByText('Edit')[0]);
    const textarea = screen.getByPlaceholderText('Add a description...');
    await user.clear(textarea);
    await user.type(textarea, 'New description');

    expect(textarea.value).toBe('New description');
  });

  it('displays tables from schema', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Tables (1)')).toBeInTheDocument();
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('2 fields')).toBeInTheDocument();
  });

  it('does not display tables section when no schema', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[1] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.queryByText(/Tables \(\d+\)/)).toBeNull();
  });

  it('handles invalid schema JSON gracefully', () => {
    const baseWithBadSchema = { ...mockBases[0], schemaJson: 'not valid json' };
    render(
      <MockAppProvider initialState={{ selectedBase: baseWithBadSchema }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    // Should render without crashing
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
    expect(screen.queryByText(/Tables \(\d+\)/)).toBeNull();
  });

  it('shows connections section', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Connections (1)')).toBeInTheDocument();
  });

  it('shows outgoing connections', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Outgoing (1)')).toBeInTheDocument();
    expect(screen.getByText('Legacy Base')).toBeInTheDocument();
    expect(screen.getByText('Products → SYNC Products')).toBeInTheDocument();
  });

  it('shows incoming connections', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[1] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Incoming (1)')).toBeInTheDocument();
    expect(screen.getByText('V2 - Test Base')).toBeInTheDocument();
  });

  it('shows "No connections detected" when no relationships', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0], relationships: [] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('No connections detected.')).toBeInTheDocument();
  });

  // BaseDetailPanel now renders a verification-status badge (unverified/verified/invalid)
  // in place of the old confidence (confirmed/suspected) text — status is a separate,
  // user-editable field on the relationship (see handleSaveRelationship / getStatusColor).
  it('shows status badge for verified relationships', () => {
    const verifiedRelationship = {
      ...mockRelationships[0],
      status: 'verified',
    };
    render(
      <MockAppProvider
        initialState={{
          selectedBase: mockBases[0],
          relationships: [verifiedRelationship],
        }}
      >
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('verified')).toBeInTheDocument();
  });

  it('shows unverified status badge by default when relationship has no status', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('unverified')).toBeInTheDocument();
  });

  it('renders Open in Airtable button', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Open in Airtable')).toBeInTheDocument();
  });

  it('opens Airtable URL when button clicked', async () => {
    const user = userEvent.setup();
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );

    await user.click(screen.getByText('Open in Airtable'));

    expect(window.open).toHaveBeenCalledWith('https://airtable.com/app123', '_blank');
  });

  it('renders close panel button', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument();
  });

  // The header no longer renders a colored bg-nodeMatch/bg-nodeOther dot for naming
  // convention status — it renders a BaseThumbnail avatar (identified by its title
  // attribute, the base name) for every base regardless of naming convention status.
  it('shows a thumbnail for a base that matches the naming convention', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[0] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(document.querySelector('[title="V2 - Test Base"]')).toBeInTheDocument();
  });

  it('shows a thumbnail for a base that does not match the naming convention', () => {
    render(
      <MockAppProvider initialState={{ selectedBase: mockBases[1] }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(document.querySelector('[title="Legacy Base"]')).toBeInTheDocument();
  });

  it('displays base ID when base name not found in relationships', () => {
    const unknownRelationship = {
      ...mockRelationships[0],
      targetBaseId: 'unknown-base-id',
    };
    render(
      <MockAppProvider
        initialState={{
          selectedBase: mockBases[0],
          relationships: [unknownRelationship],
        }}
      >
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('unknown-base-id')).toBeInTheDocument();
  });

  it('displays fields count as 0 when fields array missing', () => {
    const baseWithTableNoFields = {
      ...mockBases[0],
      schemaJson: JSON.stringify({
        tables: [{ id: 'tbl1', name: 'Empty Table' }],
      }),
    };
    render(
      <MockAppProvider initialState={{ selectedBase: baseWithTableNoFields }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('0 fields')).toBeInTheDocument();
  });

  it('handles multiple tables in schema', () => {
    const baseWithMultipleTables = {
      ...mockBases[0],
      schemaJson: JSON.stringify({
        tables: [
          { id: 'tbl1', name: 'Table 1', fields: [{ id: 'f1', name: 'F1' }] },
          {
            id: 'tbl2',
            name: 'Table 2',
            fields: [
              { id: 'f2', name: 'F2' },
              { id: 'f3', name: 'F3' },
            ],
          },
          { id: 'tbl3', name: 'Table 3', fields: [] },
        ],
      }),
    };
    render(
      <MockAppProvider initialState={{ selectedBase: baseWithMultipleTables }}>
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Tables (3)')).toBeInTheDocument();
    expect(screen.getByText('Table 1')).toBeInTheDocument();
    expect(screen.getByText('Table 2')).toBeInTheDocument();
    expect(screen.getByText('Table 3')).toBeInTheDocument();
  });

  it('handles both incoming and outgoing connections', () => {
    const bidirectionalRelationships = [
      {
        id: 1,
        sourceBaseId: 'app123',
        targetBaseId: 'app456',
        sourceTableName: 'Products',
        targetTableName: 'SYNC Products',
        confidence: 'confirmed',
      },
      {
        id: 2,
        sourceBaseId: 'app456',
        targetBaseId: 'app123',
        sourceTableName: 'Orders',
        targetTableName: 'SYNC Orders',
        confidence: 'suspected',
      },
    ];
    render(
      <MockAppProvider
        initialState={{
          selectedBase: mockBases[0],
          relationships: bidirectionalRelationships,
        }}
      >
        <BaseDetailPanel />
      </MockAppProvider>,
    );
    expect(screen.getByText('Connections (2)')).toBeInTheDocument();
    expect(screen.getByText('Outgoing (1)')).toBeInTheDocument();
    expect(screen.getByText('Incoming (1)')).toBeInTheDocument();
  });
});
