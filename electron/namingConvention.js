/**
 * Configurable naming convention.
 *
 * Lets a user mark bases whose names start with a chosen prefix (e.g. bases
 * rebuilt under a new standard) instead of hardcoding any single company's
 * convention into the app.
 *
 * @typedef {{ enabled: boolean, prefix: string, label: string }} NamingConvention
 */

const DEFAULT_CONVENTION = Object.freeze({ enabled: false, prefix: '', label: 'Matches convention' });

/**
 * Normalize arbitrary/untrusted input (e.g. from settings storage or IPC) into
 * a well-formed NamingConvention.
 * @param {*} raw
 * @returns {NamingConvention}
 */
function normalizeConvention(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONVENTION };
  return {
    enabled: Boolean(raw.enabled),
    prefix: typeof raw.prefix === 'string' ? raw.prefix : '',
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : DEFAULT_CONVENTION.label,
  };
}

/**
 * Whether a base name matches the given naming convention.
 * @param {string} baseName
 * @param {NamingConvention} convention
 * @returns {boolean}
 */
function matchesConvention(baseName, convention) {
  const c = normalizeConvention(convention);
  const prefix = c.prefix.trim().toLowerCase();
  if (!c.enabled || !prefix || typeof baseName !== 'string') return false;
  return baseName.trim().toLowerCase().startsWith(prefix);
}

/**
 * Recompute matches_convention for every stored base under the given convention.
 * Shared by the set-naming-convention IPC handler and the app-startup migration
 * path (so databases whose matches_convention column was just added by the
 * migration in database.js get real values instead of staying at the default 0).
 * @param {import('./database').database} database - the database operations wrapper
 * @param {NamingConvention} convention
 */
function recomputeConventionMatches(database, convention) {
  const normalized = normalizeConvention(convention);
  const bases = database.getAllBasesLite();
  database.beginBatch();
  try {
    for (const base of bases) {
      database.setBaseMatchesConvention(base.id, matchesConvention(base.name, normalized));
    }
    database.endBatch();
  } catch (err) {
    // Without this, a throw mid-loop would leave the transaction open
    // forever: batchTxnOpen stays true, so every later beginBatch() becomes
    // a silent no-op and all subsequent writes in the session sit uncommitted.
    database.rollbackBatch();
    throw err;
  }
}

module.exports = { DEFAULT_CONVENTION, normalizeConvention, matchesConvention, recomputeConventionMatches };
