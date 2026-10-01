const { logger } = require('./logger');
const { describeConnectionError } = require('./connectionErrors');

const MAX_FILE_REDIRECTS = 3;

/**
 * Airtable API Client with concurrent rate-limited requests
 * Rate limit: 5 requests per second
 */
class AirtableClient {
  /**
   * @param {string} token
   * @param {Object} [options]
   * @param {string} [options.baseUrl] - API root; tests point this at the fake Airtable server.
   * @param {string[]} [options.fileOrigins] - exact origins allowed for attachment downloads.
   *   When omitted, only https Airtable file hosts (*.airtableusercontent.com) are allowed.
   */
  constructor(token, { baseUrl = 'https://api.airtable.com/v0', fileOrigins = null } = {}) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.fileOrigins = fileOrigins;
    // Sliding window rate limiter: track timestamps of recent requests
    this.requestTimestamps = [];
    this.maxRequestsPerSecond = 5;
    this.maxRetries = 3;
  }

  /**
   * Wait until a rate limit slot is available, then record the request.
   * Uses a sliding window: allows up to 5 requests in any 1-second window.
   */
  async acquireRateSlot() {
    while (true) {
      const now = Date.now();
      // Remove timestamps older than 1 second
      this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 1000);

      if (this.requestTimestamps.length < this.maxRequestsPerSecond) {
        this.requestTimestamps.push(now);
        return;
      }

      // Wait until the oldest request in the window expires
      const oldestInWindow = this.requestTimestamps[0];
      const waitTime = 1000 - (now - oldestInWindow) + 10; // +10ms buffer
      await this.sleep(waitTime);
    }
  }

  /**
   * Make a rate-limited request with retry logic for 429 and 5xx errors
   */
  async request(endpoint, options = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.acquireRateSlot();

      const url = `${this.baseUrl}${endpoint}`;
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        if (response.ok) {
          return response.json();
        }

        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '30', 10);
          const waitMs = retryAfter * 1000;
          logger.warn(
            'AirtableClient',
            `Rate limited (429), waiting ${retryAfter}s before retry ${attempt + 1}/${this.maxRetries}`,
          );
          await this.sleep(waitMs);
          // Kept so a run of 429s ends in a rate-limit error, not `throw undefined`.
          lastError = Object.assign(new Error('Airtable rate limit reached'), { status: 429 });
          continue;
        }

        // Retry on server errors (5xx)
        if (response.status >= 500 && attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          logger.warn(
            'AirtableClient',
            `Server error ${response.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries})`,
          );
          await this.sleep(backoff);
          continue;
        }

        // Non-retryable error
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error?.message || `Airtable API error: ${response.status}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
      } catch (err) {
        lastError = err;
        // Retry on network errors (not HTTP errors)
        if (!err.status && attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          logger.warn(
            'AirtableClient',
            `Network error, retrying in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries}): ${err.message}`,
          );
          await this.sleep(backoff);
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test the API connection. On success, reports how many bases the token can see
   * on the first page (enough to tell "none" from "some").
   */
  async testConnection() {
    try {
      const data = await this.request('/meta/bases');
      return { success: true, baseCount: Array.isArray(data?.bases) ? data.bases.length : 0 };
    } catch (error) {
      const { code, message, helpUrl } = describeConnectionError(error);
      return { success: false, error: message, code, ...(helpUrl ? { helpUrl } : {}) };
    }
  }

  /**
   * List all bases the token has access to
   */
  async listBases() {
    const allBases = [];
    let offset = null;

    do {
      const endpoint = offset ? `/meta/bases?offset=${offset}` : '/meta/bases';
      const data = await this.request(endpoint);

      if (data.bases) {
        allBases.push(...data.bases);
      }

      offset = data.offset;
    } while (offset);

    return allBases;
  }

  /**
   * Get the schema for a specific base
   */
  async getBaseSchema(baseId) {
    const data = await this.request(`/meta/bases/${baseId}/tables`);
    return data;
  }

  /**
   * Get a single base info
   */
  async getBase(baseId) {
    const data = await this.request(`/meta/bases/${baseId}`);
    return data;
  }

  /**
   * List one page (up to 100) of a table's records, with fields keyed by
   * field id so renamed fields still line up. Pass the returned `offset` back
   * in to get the next page; there are no more pages when it is absent.
   */
  async listRecords(baseId, tableId, { offset } = {}) {
    const params = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
    if (offset) params.set('offset', offset);
    return this.request(`/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params}`);
  }

  /**
   * Whether an attachment URL points at Airtable's file host (or, in tests,
   * at one of the configured fileOrigins). Attachment URLs come from API
   * responses, so this keeps a tampered response from making the app fetch
   * an arbitrary address.
   */
  isAllowedFileUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (this.fileOrigins) return this.fileOrigins.includes(parsed.origin);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (host === 'airtableusercontent.com' || host.endsWith('.airtableusercontent.com'))
    );
  }

  /**
   * Download an attachment file. Attachment URLs are signed and need no
   * token. Redirects are followed by hand so every hop is checked against the
   * allowed file hosts; fetch's automatic redirects would let an allowed host
   * send the app anywhere. Throws with `.status` set when the file host
   * answers with an error (for example 410 once the URL has expired).
   */
  async downloadFile(url) {
    let current = url;
    let response;
    for (let hop = 0; ; hop++) {
      if (!this.isAllowedFileUrl(current)) {
        throw new Error('Refusing to download a file that is not an Airtable file address');
      }
      response = await fetch(current, { redirect: 'manual' });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      if (hop >= MAX_FILE_REDIRECTS) {
        throw new Error('File download redirected too many times');
      }
      current = new URL(location, current).href;
    }
    if (!response.ok) {
      const error = new Error(`File download failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Fetch schemas for multiple bases concurrently with rate limiting.
   * Uses a worker pool pattern: N workers pull from a shared queue.
   * @param {Array} bases - Array of base objects with .id and .name
   * @param {Function} onProgress - Callback(current, total, baseName) for progress reporting
   * @param {Function} onResult - Callback(base, schema, error) for each result
   * @param {number} concurrency - Number of concurrent workers (default: 4, max 5 to stay under rate limit)
   */
  async fetchSchemasConcurrently(bases, { onProgress, onResult, concurrency = 4 } = {}) {
    let nextIndex = 0;
    let completed = 0;
    const total = bases.length;

    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= total) return;

        const base = bases[index];
        try {
          const schema = await this.getBaseSchema(base.id);
          completed++;
          if (onProgress) onProgress(completed, total, base.name);
          if (onResult) onResult(base, schema, null);
        } catch (err) {
          completed++;
          logger.error(
            'AirtableClient',
            `Failed to fetch schema for "${base.name}" (${base.id}): ${err.message}`,
          );
          if (onProgress) onProgress(completed, total, base.name);
          if (onResult) onResult(base, null, err);
        }
      }
    };

    // Launch worker pool
    const workers = [];
    const workerCount = Math.min(concurrency, this.maxRequestsPerSecond, total);
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }
}

module.exports = { AirtableClient };
