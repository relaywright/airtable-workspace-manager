import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { describeConnectionError, checkTokenShape } = require('./connectionErrors.js');

const httpError = (status) => Object.assign(new Error(`Airtable API error: ${status}`), { status });

describe('describeConnectionError', () => {
  it('explains a rejected token without Airtable jargon', () => {
    const result = describeConnectionError(httpError(401));
    expect(result.code).toBe('bad-token');
    expect(result.message).toMatch(/didn't accept this token/);
    expect(result.helpUrl).toBe('https://airtable.com/create/tokens');
  });

  it('names the missing scope', () => {
    expect(describeConnectionError(httpError(403)).message).toMatch(/schema\.bases:read/);
  });

  it('turns a dropped connection into a connection message', () => {
    const offline = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const result = describeConnectionError(offline);
    expect(result.code).toBe('network');
    expect(result.message).not.toMatch(/fetch failed/);
  });

  it('covers rate limits and Airtable outages', () => {
    expect(describeConnectionError(httpError(429)).code).toBe('rate-limited');
    expect(describeConnectionError(httpError(503)).code).toBe('airtable-down');
  });

  it('never uses an em dash', () => {
    for (const status of [401, 403, 429, 503, 418]) {
      expect(describeConnectionError(httpError(status)).message).not.toContain('\u2014');
    }
  });
});

describe('checkTokenShape', () => {
  it('flags a retired legacy API key', () => {
    expect(checkTokenShape('key' + 'A'.repeat(14))).toMatch(/personal access token/);
  });
  it('accepts a personal access token', () => {
    expect(checkTokenShape('patAbc123.0123456789abcdef')).toBeNull();
  });
});
