/**
 * Turns anything that stops a backup into a message a non-technical person
 * can act on: what happened, what it means for their data, what to do.
 */
const TOKEN_PAGE_URL = 'https://airtable.com/create/tokens';

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function isNetworkError(err) {
  if (!err || err.status) return false;
  if (err.name === 'TypeError' && err.message === 'fetch failed') return true;
  return NETWORK_CODES.has(err.code) || NETWORK_CODES.has(err.cause?.code);
}

function describeBackupError(err) {
  if (err?.code === 'ENOSPC' || err?.code === 'SQLITE_FULL') {
    // The failing file plus headroom for the backup database itself.
    const neededMb = Math.ceil((err.bytesNeeded || 0) / 1_000_000) + 100;
    return {
      code: 'disk-full',
      message: `Your backup drive ran out of space, so this backup stopped. Your earlier restore points are still safe. Free up at least ${neededMb} MB on the drive that holds your backups, then run the backup again.`,
    };
  }
  if (err?.status === 401) {
    return {
      code: 'bad-token',
      message:
        'Airtable did not accept your token, so nothing new was backed up. Your earlier restore points are still safe. Add a working token in Settings, then run the backup again.',
    };
  }
  if (err?.status === 403 || err?.status === 404) {
    return {
      code: 'missing-scope',
      message:
        'Your Airtable token is not allowed to read this base, so nothing new was backed up. Your earlier restore points are still safe. Edit the token, tick "data.records:read" and "schema.bases:read", and make sure this base is listed under Access. Then run the backup again.',
      helpUrl: TOKEN_PAGE_URL,
    };
  }
  if (err?.status === 429) {
    return {
      code: 'rate-limited',
      message:
        'Airtable asked the app to slow down several times in a row, so this backup stopped early. Nothing from it was kept, and your earlier restore points are still safe. Try again in a few minutes.',
    };
  }
  if (isNetworkError(err)) {
    return {
      code: 'network',
      message:
        'The connection to Airtable dropped during this backup. Nothing from this attempt was kept, no records were marked as deleted, and your earlier restore points are still safe. The next backup will pick up normally.',
    };
  }
  return {
    code: 'unknown',
    message: `This backup stopped because of an unexpected problem (${err?.message || 'no details'}). Nothing from this attempt was kept, and your earlier restore points are still safe. Try again later.`,
  };
}

module.exports = { describeBackupError, isNetworkError, TOKEN_PAGE_URL };
