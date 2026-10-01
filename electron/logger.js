/**
 * Tiny leveled logger for the main process. No dependencies, no transports,
 * no files: just a thin wrapper around console that keeps a healthy app
 * start quiet.
 *
 * `debug` and `info` only print in development. Detecting "development" must
 * not require('electron') in a way that breaks tests run under
 * ELECTRON_RUN_AS_NODE (where requiring 'electron' returns a path string, not
 * the app API), so NODE_ENV is checked first and app.isPackaged is only
 * consulted when it is actually available.
 */

function isDev() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.NODE_ENV === 'development') return true;
  try {
    const { app } = require('electron');
    if (app && typeof app.isPackaged === 'boolean') {
      return !app.isPackaged;
    }
  } catch {
    // Not running inside Electron's main process (plain Node, or
    // ELECTRON_RUN_AS_NODE). Fall through to the NODE_ENV check below.
  }
  return process.env.NODE_ENV !== 'production';
}

function tag(scope) {
  return `[${scope}]`;
}

const logger = {
  debug(scope, ...args) {
    // In Node, console.debug and console.info both write to stdout; debug uses info.
    if (isDev()) console.info(tag(scope), ...args);
  },
  info(scope, ...args) {
    if (isDev()) console.info(tag(scope), ...args);
  },
  warn(scope, ...args) {
    console.warn(tag(scope), ...args);
  },
  error(scope, ...args) {
    console.error(tag(scope), ...args);
  },
};

module.exports = { logger };
