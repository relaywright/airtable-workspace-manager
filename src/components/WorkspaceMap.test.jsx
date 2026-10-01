import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import cytoscape from 'cytoscape';
import { WorkspaceMap, getMapStylesheet, TRACE_COLORS } from './WorkspaceMap';
import { AppContext, AppProvider } from '../context/AppContext';
import demoBases from '../../fixtures/demo-workspace/bases.json';

vi.mock('../utils/graphViewport', () => ({ fitGraph: vi.fn() }));

// Mock cytoscape
vi.mock('cytoscape', () => {
  let nodes = [];
  const mockCy = {
    on: vi.fn(),
    elements: vi.fn().mockReturnValue({
      remove: vi.fn(() => {
        nodes = [];
      }),
    }),
    add: vi.fn((elements) => {
      nodes = elements
        .filter(({ data }) => !data.source)
        .map(({ data }) => ({
          id: () => data.id,
          addClass: vi.fn(),
          select: vi.fn(),
        }));
    }),
    batch: vi.fn((fn) => fn()),
    layout: vi.fn().mockReturnValue({ run: vi.fn() }),
    fit: vi.fn(),
    nodes: vi.fn().mockReturnValue({
      unselect: vi.fn(),
      removeClass: vi.fn(),
      forEach: vi.fn((fn) => nodes.forEach(fn)),
    }),
    edges: vi.fn().mockReturnValue({ removeClass: vi.fn(), forEach: vi.fn() }),
    getElementById: vi.fn((id) => nodes.find((node) => node.id() === id)),
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

function TestWrapper({ children }) {
  return <AppProvider>{children}</AppProvider>;
}

describe('WorkspaceMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = {
      getToken: vi.fn().mockResolvedValue(null),
      setToken: vi.fn().mockResolvedValue({ success: true }),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
      getBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getBase: vi.fn().mockResolvedValue({ success: true, data: null }),
      getRelationships: vi.fn().mockResolvedValue({ success: true, data: [] }),
      fetchAllBases: vi.fn().mockResolvedValue({ success: true, data: [] }),
      fetchBaseSchema: vi.fn().mockResolvedValue({ success: true, data: {} }),
      refreshSchemas: vi.fn().mockResolvedValue({ success: true, basesUpdated: 0 }),
      updateBaseDescription: vi.fn().mockResolvedValue({ success: true }),
      clearData: vi.fn().mockResolvedValue({ success: true }),
      getLastSync: vi.fn().mockResolvedValue({ success: true, data: null }),
      setLastSync: vi.fn().mockResolvedValue({ success: true }),
      classifyBases: vi.fn().mockResolvedValue({ success: true, data: {} }),
      detectCircularDeps: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };
  });

  it('renders map container', () => {
    render(
      <TestWrapper>
        <WorkspaceMap />
      </TestWrapper>,
    );
    const container = document.querySelector('.bg-background');
    expect(container).toBeInTheDocument();
  });

  it('renders zoom controls', () => {
    render(
      <TestWrapper>
        <WorkspaceMap />
      </TestWrapper>,
    );
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fit to view/i })).toBeInTheDocument();
  });

  it('renders legend', () => {
    render(
      <TestWrapper>
        <WorkspaceMap />
      </TestWrapper>,
    );
    expect(screen.getByText('Legend')).toBeInTheDocument();
    expect(screen.getByText('Confirmed sync')).toBeInTheDocument();
    expect(screen.getByText('Suspected sync')).toBeInTheDocument();
  });

  it('hides naming convention entries from the legend while no convention is enabled', () => {
    render(
      <TestWrapper>
        <WorkspaceMap />
      </TestWrapper>,
    );
    // Nodes carry no convention outline unless a convention is set up in Settings
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(document.querySelector('.border-nodeMatch')).toBeNull();
    expect(document.querySelector('.border-nodeOther')).toBeNull();
  });

  it('renders edge color indicators in legend', () => {
    render(
      <TestWrapper>
        <WorkspaceMap />
      </TestWrapper>,
    );
    const confirmedIndicator = document.querySelector('.bg-edgeConfirmed');
    const suspectedIndicator = document.querySelector('.bg-edgeSuspected');
    expect(confirmedIndicator).toBeInTheDocument();
    expect(suspectedIndicator).toBeInTheDocument();
  });

  it('uses the same colors for trace roles on the map and in the legend', async () => {
    window.api.detectCircularDeps.mockResolvedValue({
      success: true,
      data: [{ path: [demoBases[0].id, demoBases[1].id, demoBases[0].id] }],
    });
    render(
      <TestWrapper>
        <WorkspaceMap />
      </TestWrapper>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Trace Mode/ }));
    await screen.findByText('Circular dependency');
    const sheet = getMapStylesheet(false);
    const borderFor = (selector) => sheet.find((rule) => rule.selector === selector).style['border-color'];
    for (const role of ['source', 'leaf', 'relay', 'isolated', 'circular']) {
      expect(borderFor(`node.trace-${role}`)).toBe(TRACE_COLORS[role]);
      expect(screen.getByTestId(`legend-swatch-${role}`)).toHaveStyle({ borderColor: TRACE_COLORS[role] });
    }
    expect(borderFor('node.trace-highlighted')).toBe(TRACE_COLORS.path);
    const edgeStyle = sheet.find((rule) => rule.selector === 'edge.trace-highlighted').style;
    expect(edgeStyle['line-color']).toBe(TRACE_COLORS.path);
    expect(edgeStyle['target-arrow-color']).toBe(TRACE_COLORS.path);
    expect(screen.getByTestId('legend-swatch-path')).toHaveStyle({ backgroundColor: TRACE_COLORS.path });
    expect(screen.getByText('Traced path')).toBeInTheDocument();
  });

  it('reloads trace classifications when relationships refresh with trace mode on', async () => {
    const base = demoBases[0];
    window.api.classifyBases.mockResolvedValue({ success: true, data: { [base.id]: 'source' } });
    const context = { bases: [base], relationships: [], selectedBase: null, selectBase: vi.fn() };
    const { rerender } = render(
      <AppContext.Provider value={context}>
        <WorkspaceMap />
      </AppContext.Provider>,
    );
    const cy = cytoscape.mock.results[0].value;
    await userEvent.click(screen.getByRole('button', { name: /Trace Mode/ }));
    await waitFor(() => expect(cy.getElementById(base.id).addClass).toHaveBeenCalledWith('trace-source'));
    expect(window.api.classifyBases).toHaveBeenCalledTimes(1);

    window.api.classifyBases.mockResolvedValue({ success: true, data: { [base.id]: 'leaf' } });
    rerender(
      <AppContext.Provider value={{ ...context, relationships: [] }}>
        <WorkspaceMap />
      </AppContext.Provider>,
    );

    await waitFor(() => expect(window.api.classifyBases).toHaveBeenCalledTimes(2));
    expect(window.api.detectCircularDeps).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(cy.getElementById(base.id).addClass).toHaveBeenCalledWith('trace-leaf'));
  });

  it('reapplies trace role classes after the bases refresh', async () => {
    const base = demoBases[0];
    window.api.classifyBases.mockResolvedValue({ success: true, data: { [base.id]: 'source' } });
    const context = { bases: [base], relationships: [], selectedBase: null, selectBase: vi.fn() };
    const { rerender } = render(
      <AppContext.Provider value={context}>
        <WorkspaceMap />
      </AppContext.Provider>,
    );
    const cy = cytoscape.mock.results[0].value;
    await waitFor(() => expect(cy.getElementById(base.id)).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: /Trace Mode/ }));
    const originalNode = cy.getElementById(base.id);
    await waitFor(() => expect(originalNode.addClass).toHaveBeenCalledWith('trace-source'));

    rerender(
      <AppContext.Provider value={{ ...context, bases: [{ ...base }] }}>
        <WorkspaceMap />
      </AppContext.Provider>,
    );
    await waitFor(() => {
      const refreshedNode = cy.getElementById(base.id);
      expect(refreshedNode).toBeDefined();
      expect(refreshedNode).not.toBe(originalNode);
      expect(refreshedNode.addClass).toHaveBeenCalledWith('trace-source');
    });
    expect(window.api.classifyBases).toHaveBeenCalledTimes(1);
  });
});
