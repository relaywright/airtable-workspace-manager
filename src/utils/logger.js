/**
 * Tiny leveled logger for the renderer. No dependencies, no transports, no
 * files: just a thin wrapper around console that keeps a healthy app start
 * quiet. `debug` and `info` only print in development (`import.meta.env.DEV`);
 * `warn` and `error` always print.
 */

function tag(scope) {
  return `[${scope}]`;
}

export const logger = {
  debug(scope, ...args) {
    // Dev-only either way; info keeps these visible at DevTools' default level.
    if (import.meta.env.DEV) console.info(tag(scope), ...args);
  },
  info(scope, ...args) {
    if (import.meta.env.DEV) console.info(tag(scope), ...args);
  },
  warn(scope, ...args) {
    console.warn(tag(scope), ...args);
  },
  error(scope, ...args) {
    console.error(tag(scope), ...args);
  },
};
