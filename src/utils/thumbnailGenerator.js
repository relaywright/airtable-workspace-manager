/**
 * Thumbnail Generator
 * Generates Airtable-style gradient thumbnails with initials
 */

// Airtable-inspired color palette
const COLOR_PALETTE = [
  { primary: '#f97316', secondary: '#fb923c' }, // Orange
  { primary: '#eab308', secondary: '#facc15' }, // Yellow
  { primary: '#22c55e', secondary: '#4ade80' }, // Green
  { primary: '#14b8a6', secondary: '#2dd4bf' }, // Teal
  { primary: '#06b6d4', secondary: '#22d3ee' }, // Cyan
  { primary: '#3b82f6', secondary: '#60a5fa' }, // Blue
  { primary: '#6366f1', secondary: '#818cf8' }, // Indigo
  { primary: '#8b5cf6', secondary: '#a78bfa' }, // Violet
  { primary: '#d946ef', secondary: '#e879f9' }, // Fuchsia
  { primary: '#ec4899', secondary: '#f472b6' }, // Pink
  { primary: '#ef4444', secondary: '#f87171' }, // Red
  { primary: '#78716c', secondary: '#a8a29e' }, // Stone
];

/**
 * Simple hash function to convert string to number
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get color pair deterministically based on base ID
 */
export function getColorForBase(baseId) {
  const index = hashString(baseId) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
}

// Connector words that should never become an initial ("Orders & Fulfillment" is "OF").
const INITIALS_STOP_WORDS = new Set(['and', 'of', 'the']);

/**
 * Extract initials from a base name (max 2 characters): the first letters of the first
 * two meaningful words, or the first two letters of a single-word name. Symbols and
 * connector words are skipped.
 */
export function getInitials(name) {
  if (!name) return '??';

  // Remove common generic prefixes
  const cleanName = name.replace(/^(APP|DB|API)\s+/i, '');

  const toWords = (text) =>
    text
      .split(/[\s_-]+/)
      .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter(Boolean);

  let allWords = toWords(cleanName);
  if (allWords.length === 0) allWords = toWords(name);
  const meaningful = allWords.filter((word) => !INITIALS_STOP_WORDS.has(word.toLowerCase()));
  const words = meaningful.length > 0 ? meaningful : allWords;

  if (words.length === 0) return '??';
  const initials =
    words.length === 1
      ? Array.from(words[0]).slice(0, 2).join('')
      : Array.from(words[0])[0] + Array.from(words[1])[0];
  return initials.toUpperCase();
}

/**
 * Generate SVG thumbnail as a data URL
 * @param {string} baseId - The base ID (for deterministic color)
 * @param {string} baseName - The base name (for initials)
 * @param {number} size - Size in pixels (default 40)
 * @returns {string} - Data URL for the SVG
 */
export function generateThumbnailDataUrl(baseId, baseName, size = 40) {
  const colors = getColorForBase(baseId);
  const initials = getInitials(baseName);
  const gradId = baseId.substring(0, 8).replace(/[^a-zA-Z0-9]/g, '');
  const fontSize = Math.round(size * 0.4);
  const rx = Math.round(size * 0.2);

  // XML-escape initials for safe embedding
  const safeInitials = initials
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // An SVG used as an image doesn't inherit the page font, so name one or it falls back to serif.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="g${gradId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${colors.primary}"/><stop offset="100%" stop-color="${colors.secondary}"/></linearGradient></defs><rect width="${size}" height="${size}" rx="${rx}" fill="url(#g${gradId})"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="white" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${fontSize}" font-weight="600">${safeInitials}</text></svg>`;

  try {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  } catch {
    // Fallback: plain colored rect without text
    const fallback = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="${colors.primary}"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(fallback)}`;
  }
}

/**
 * Generate CSS gradient string for backgrounds
 */
export function generateGradient(baseId) {
  const colors = getColorForBase(baseId);
  return `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`;
}

export default {
  getColorForBase,
  getInitials,
  generateThumbnailDataUrl,
  generateGradient,
};
