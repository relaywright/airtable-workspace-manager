/**
 * URL policy for the app window: which links may open in the system browser,
 * and which URLs count as the app itself (for navigation and IPC sender checks).
 * Pure functions so they can be tested without Electron.
 */

// Exact hosts, plus any subdomain of the entries in SUBDOMAIN_HOSTS.
const EXACT_HOSTS = new Set(['anthropic.com', 'console.anthropic.com']);
const SUBDOMAIN_HOSTS = ['airtable.com'];

function parseUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True when `url` is an https link to Airtable or Anthropic that may be handed
 * to the system browser.
 */
function isAllowedExternalUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed || parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (EXACT_HOSTS.has(host)) return true;
  return SUBDOMAIN_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// Null for a path with a malformed escape (a stray %), so callers fail closed
// instead of throwing.
function safeDecode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * True when `url` belongs to the app's own origin. `appOrigin` is the dev server
 * origin (e.g. http://localhost:5174) for dev, or the exact file: URL of the
 * packaged build's entry HTML file (e.g. file:///C:/app/dist/index.html) for
 * the packaged build. A bare 'file://' is intentionally not treated as
 * matching every local file: that would let any HTML file on disk count as
 * the app.
 */
function isAppUrl(url, appOrigin) {
  const parsed = parseUrl(url);
  const parsedOrigin = parseUrl(appOrigin);
  if (!parsed || !parsedOrigin) return false;

  if (parsedOrigin.protocol === 'file:') {
    if (parsed.protocol !== 'file:') return false;
    const candidatePath = safeDecode(parsed.pathname);
    const entryPath = safeDecode(parsedOrigin.pathname);
    if (candidatePath === null || entryPath === null) return false;
    return process.platform === 'win32'
      ? candidatePath.toLowerCase() === entryPath.toLowerCase()
      : candidatePath === entryPath;
  }

  return parsed.origin === parsedOrigin.origin;
}

module.exports = { isAllowedExternalUrl, isAppUrl };
