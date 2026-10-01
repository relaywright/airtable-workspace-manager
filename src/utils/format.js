/**
 * Format a count with its noun, choosing singular or plural form.
 * pluralize(1, 'table') -> "1 table"; pluralize(3, 'table') -> "3 tables"
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural] - defaults to singular + "s"
 * @returns {string}
 */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Human-readable size in decimal units: formatBytes(2400) -> "2.4 KB".
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes || 0;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  if (unit === 0) return `${value} bytes`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

// SQLite's datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker,
// which JavaScript would otherwise read as local time.
const SQLITE_UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Parse a stored timestamp into a Date, treating zone-less SQLite values as UTC.
 * @param {string | number | Date | null | undefined} value
 * @returns {Date | null} null when the value is missing or unreadable
 */
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  const text = typeof value === 'number' ? value : String(value).trim();
  const date = new Date(
    typeof text === 'string' && SQLITE_UTC_RE.test(text) ? `${text.replace(' ', 'T')}Z` : text,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
