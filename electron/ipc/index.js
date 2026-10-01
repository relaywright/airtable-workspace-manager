/**
 * Registers every feature IPC module against ipcMain.
 *
 * Every handler is wrapped so it only runs for calls from the app's own page:
 * the sender frame must exist and its URL must match `ctx.appOrigin` (the dev
 * server origin, or 'file://' for the packaged build).
 */
const { isAppUrl } = require('../externalLinks');
const tokens = require('./tokens');
const bases = require('./bases');
const relationships = require('./relationships');
const tags = require('./tags');
const snapshots = require('./snapshots');
const settings = require('./settings');
const exportsModule = require('./exports');
const analysis = require('./analysis');
const accounts = require('./accounts');
const ai = require('./ai');
const demo = require('./demo');
const backup = require('./backup');

function assertTrustedSender(event, channel, appOrigin) {
  const url = event?.senderFrame?.url;
  if (!isAppUrl(url, appOrigin)) {
    throw new Error(`Blocked IPC call to "${channel}" from untrusted sender: ${url || 'unknown'}`);
  }
}

function createTrustedIpc(ipcMain, appOrigin) {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedSender(event, channel, appOrigin);
        return handler(event, ...args);
      });
    },
  };
}

function registerAll(ipcMain, ctx) {
  if (!ctx.appOrigin) {
    throw new Error('registerAll requires ctx.appOrigin to verify IPC senders');
  }
  const trustedIpc = createTrustedIpc(ipcMain, ctx.appOrigin);
  tokens.register(trustedIpc, ctx);
  bases.register(trustedIpc, ctx);
  relationships.register(trustedIpc, ctx);
  tags.register(trustedIpc, ctx);
  snapshots.register(trustedIpc, ctx);
  settings.register(trustedIpc, ctx);
  exportsModule.register(trustedIpc, ctx);
  analysis.register(trustedIpc, ctx);
  accounts.register(trustedIpc, ctx);
  ai.register(trustedIpc, ctx);
  demo.register(trustedIpc, ctx);
  backup.register(trustedIpc, ctx);
}

module.exports = { registerAll };
