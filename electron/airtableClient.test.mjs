import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AirtableClient } from './airtableClient.js';

// Mock global fetch
global.fetch = vi.fn();

describe('AirtableClient', () => {
  let client;

  beforeEach(() => {
    client = new AirtableClient('test-token');
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('sets the token', () => {
      expect(client.token).toBe('test-token');
    });

    it('sets the base URL', () => {
      expect(client.baseUrl).toBe('https://api.airtable.com/v0');
    });

    it('configures the sliding-window rate limiter', () => {
      expect(client.maxRequestsPerSecond).toBe(5);
      expect(client.requestTimestamps).toEqual([]);
    });

    it('configures retry behavior', () => {
      expect(client.maxRetries).toBe(3);
    });
  });

  describe('request', () => {
    it('makes fetch request with authorization header', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      await client.request('/meta/bases');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.airtable.com/v0/meta/bases',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('returns JSON response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await client.request('/meta/bases');

      expect(result).toEqual({ data: 'test' });
    });

    it('throws error on non-ok response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
      });

      await expect(client.request('/meta/bases')).rejects.toThrow('Unauthorized');
    });

    it('throws generic error when no error message in response', async () => {
      // Disable retries so the test focuses on error-message formatting, not retry timing
      client.maxRetries = 0;
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      await expect(client.request('/meta/bases')).rejects.toThrow('Airtable API error: 500');
    });

    it('handles JSON parse failure gracefully', async () => {
      // Disable retries so the test focuses on the JSON-parse-failure fallback
      client.maxRetries = 0;
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(client.request('/meta/bases')).rejects.toThrow('Airtable API error: 500');
    });
  });

  describe('testConnection', () => {
    it('returns success true on successful connection', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ bases: [] }),
      });

      const result = await client.testConnection();

      expect(result).toEqual({ success: true, baseCount: 0 });
    });

    it('returns success false with error message on failure', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'Invalid token' } }),
      });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.code).toBe('bad-token');
      expect(result.error).toMatch(/didn't accept this token/);
    });
  });

  describe('listBases', () => {
    it('returns list of bases', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            bases: [
              { id: 'app1', name: 'Base 1' },
              { id: 'app2', name: 'Base 2' },
            ],
          }),
      });

      const bases = await client.listBases();

      expect(bases).toHaveLength(2);
      expect(bases[0].id).toBe('app1');
      expect(bases[1].id).toBe('app2');
    });

    it('handles pagination', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              bases: [{ id: 'app1', name: 'Base 1' }],
              offset: 'next-page',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              bases: [{ id: 'app2', name: 'Base 2' }],
            }),
        });

      const bases = await client.listBases();

      expect(bases).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no bases', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const bases = await client.listBases();

      expect(bases).toEqual([]);
    });
  });

  describe('getBaseSchema', () => {
    it('returns schema for base', async () => {
      const mockSchema = {
        tables: [
          {
            id: 'tbl1',
            name: 'Table 1',
            fields: [{ id: 'fld1', name: 'Field 1', type: 'text' }],
          },
        ],
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSchema),
      });

      const schema = await client.getBaseSchema('app123');

      expect(schema).toEqual(mockSchema);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.airtable.com/v0/meta/bases/app123/tables',
        expect.any(Object),
      );
    });
  });

  describe('getBase', () => {
    it('returns base info', async () => {
      const mockBase = { id: 'app123', name: 'Test Base' };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockBase),
      });

      const base = await client.getBase('app123');

      expect(base).toEqual(mockBase);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.airtable.com/v0/meta/bases/app123',
        expect.any(Object),
      );
    });
  });

  describe('sleep', () => {
    it('waits for specified milliseconds', async () => {
      const startTime = Date.now();
      await client.sleep(100);
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
    });
  });
});
