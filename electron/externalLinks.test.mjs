import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { isAllowedExternalUrl, isAppUrl } = require('./externalLinks.js');

describe('external link policy', () => {
  it('allows only https Airtable and Anthropic links', () => {
    expect(isAllowedExternalUrl('https://airtable.com/create/tokens')).toBe(true);
    expect(isAllowedExternalUrl('https://support.airtable.com/docs')).toBe(true);
    expect(isAllowedExternalUrl('https://console.anthropic.com/settings/keys')).toBe(true);
    expect(isAllowedExternalUrl('https://anthropic.com')).toBe(true);

    expect(isAllowedExternalUrl('https://evil.example.com')).toBe(false);
    expect(isAllowedExternalUrl('https://airtable.com.evil.example')).toBe(false);
    expect(isAllowedExternalUrl('https://notairtable.com')).toBe(false);
    expect(isAllowedExternalUrl('https://docs.anthropic.com.evil.example')).toBe(false);
    expect(isAllowedExternalUrl('https://airtable.com@evil.example.com')).toBe(false);
    expect(isAllowedExternalUrl('http://airtable.com/create/tokens')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
    expect(isAllowedExternalUrl('')).toBe(false);
    expect(isAllowedExternalUrl(undefined)).toBe(false);
  });

  it('recognizes the app origin in dev and packaged builds', () => {
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5174')).toBe(true);
    expect(isAppUrl('http://localhost:5175/', 'http://localhost:5174')).toBe(false);
    expect(isAppUrl('https://airtable.com/', 'http://localhost:5174')).toBe(false);
    expect(isAppUrl('http://localhost:5174/', undefined)).toBe(false);

    const entryUrl = 'file:///C:/app/dist/index.html';
    expect(isAppUrl('file:///C:/app/dist/index.html', entryUrl)).toBe(true);
    expect(isAppUrl('file:///C:/app/dist/index.html#/bases/123', entryUrl)).toBe(true);
    expect(isAppUrl('file:///C:/app/dist/other.html', entryUrl)).toBe(false);
    expect(isAppUrl('file:///C:/app/elsewhere/index.html', entryUrl)).toBe(false);
    expect(isAppUrl('https://airtable.com/', entryUrl)).toBe(false);

    // A bare 'file://' as appOrigin must not trust arbitrary local files.
    expect(isAppUrl('file:///C:/app/dist/index.html', 'file://')).toBe(false);
    expect(isAppUrl('file:///etc/passwd', 'file://')).toBe(false);

    // A stray % can't be decoded. The check must answer false, not throw:
    // will-navigate calls it before preventDefault, so a throw lets the page leave.
    expect(isAppUrl('file:///C:/Downloads/100%.html', entryUrl)).toBe(false);
  });
});
