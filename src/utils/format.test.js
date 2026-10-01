import { describe, it, expect } from 'vitest';
import { parseTimestamp } from './format';

describe('parseTimestamp', () => {
  it('reads a SQLite UTC timestamp (no zone marker) as UTC', () => {
    expect(parseTimestamp('2026-10-01 14:00:00').toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('leaves an ISO timestamp that already has a zone unchanged', () => {
    expect(parseTimestamp('2026-10-01T14:00:00.000Z').toISOString()).toBe('2026-10-01T14:00:00.000Z');
    expect(parseTimestamp('2026-10-01T16:00:00+02:00').toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('returns null for missing or unreadable values', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('not a date')).toBeNull();
  });
});
