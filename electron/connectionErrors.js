/**
 * Turns a failed Airtable connection check into a message a non-technical
 * person can act on. Used by the setup screen's Test Connection and Save.
 */
const { isNetworkError, TOKEN_PAGE_URL } = require('./backup/backupErrors');

function describeConnectionError(err) {
  if (err?.status === 401) {
    return {
      code: 'bad-token',
      message:
        "Airtable didn't accept this token. Check that you copied the whole token (it starts with \"pat\"), and that it hasn't been deleted on Airtable's token page.",
      helpUrl: TOKEN_PAGE_URL,
    };
  }
  if (err?.status === 403) {
    return {
      code: 'missing-scope',
      message:
        'This token works, but it isn\'t allowed to read your bases. On Airtable\'s token page, edit the token, add the "schema.bases:read" scope, and add your workspace under Access.',
      helpUrl: TOKEN_PAGE_URL,
    };
  }
  if (err?.status === 429) {
    return {
      code: 'rate-limited',
      message: 'Airtable is busy and asked the app to slow down. Wait a minute, then try again.',
    };
  }
  if (err?.status >= 500) {
    return {
      code: 'airtable-down',
      message: `Airtable is having trouble right now (error ${err.status}). Try again in a few minutes.`,
    };
  }
  if (isNetworkError(err)) {
    return {
      code: 'network',
      message: "The app couldn't reach Airtable. Check your internet connection, then try again.",
    };
  }
  return {
    code: 'unknown',
    message: `Airtable returned an unexpected error: ${err?.message || 'no details'}. Try again, and if it keeps happening, create a new token.`,
  };
}

// Airtable retired "key..." API keys in 2024; only personal access tokens work now.
function checkTokenShape(token) {
  if (/^key[A-Za-z0-9]{14}$/.test(token)) {
    return 'This looks like an old Airtable API key, which Airtable no longer accepts. Create a personal access token instead (it starts with "pat").';
  }
  return null;
}

module.exports = { describeConnectionError, checkTokenShape, TOKEN_PAGE_URL };
