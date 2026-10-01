import { afterEach, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { configure } from '@testing-library/dom';
import '@testing-library/jest-dom/vitest';

// @testing-library/react configures act-wrapping on its OWN nested copy of
// @testing-library/dom (present because @testing-library/react pins
// "@testing-library/dom": "^9.0.0" while the rest of the tree resolves the
// newer top-level v10 copy). @testing-library/user-event imports
// '@testing-library/dom' unqualified, which resolves to that top-level v10
// copy, a different config singleton that never gets the eventWrapper/
// asyncWrapper act() config react-testing-library sets up. The result: every
// keystroke and click dispatched through userEvent lands outside of act(),
// producing an "update was not wrapped in act(...)" warning per event even
// though the test's own render() calls are correctly act-wrapped.
//
// Re-applying the same configuration here, importing '@testing-library/dom'
// the same unqualified way user-event does, targets that top-level copy's
// config singleton directly, so userEvent's dispatched events go through
// act() too. This is a test-harness fix for a duplicate-dependency resolution
// issue, not a change to any component's behavior.
configure({
  unstable_advanceTimersWrapper: (cb) => act(cb),
  eventWrapper: (cb) => {
    let result;
    act(() => {
      result = cb();
    });
    return result;
  },
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.api for renderer tests
const mockApi = {
  getToken: vi.fn().mockResolvedValue({ hasToken: false, last4: null }),
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
};

Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true,
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock window.open
window.open = vi.fn();

// Mock window.confirm
window.confirm = vi.fn().mockReturnValue(true);
