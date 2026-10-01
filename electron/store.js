const Store = require('electron-store');
const { logger } = require('./logger');

/**
 * Secrets (the active Airtable token, each account's token, and the Anthropic
 * key) are encrypted with the OS keychain through an injected codec:
 *
 *   { isAvailable(): boolean, encrypt(str): base64, decrypt(base64): str }
 *
 * main.js builds the codec from Electron's safeStorage. Tests inject a fake,
 * which keeps this module loadable under ELECTRON_RUN_AS_NODE where safeStorage
 * does not exist. Encrypted values live in `<field>Enc`; the plaintext field is
 * only used when OS encryption is unavailable (for example Linux with no keyring).
 */
const TOP_LEVEL_SECRETS = ['apiToken', 'anthropicApiKey'];

const NO_ENCRYPTION = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('Encryption is not available');
  },
  decrypt: () => {
    throw new Error('Encryption is not available');
  },
};

let store = null;
let codec = NO_ENCRYPTION;
let warnedPlaintext = false;

/**
 * Build the secret codec from Electron's safeStorage module.
 */
function createSafeStorageCodec(safeStorage) {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')),
  };
}

/**
 * Create and initialize the electron store.
 *
 * @param {Object} [options]
 * @param {Object} [options.codec] - secret codec; defaults to no encryption.
 * @param {string} [options.cwd] - config directory override (tests use a temp dir).
 */
function createStore({ codec: secretCodec = NO_ENCRYPTION, cwd } = {}) {
  codec = secretCodec;
  warnedPlaintext = false;
  store = new Store({
    name: 'workspace-manager-config',
    ...(cwd ? { cwd } : {}),
    // Obfuscation only, not security: this key is public. It stays so config files
    // written by earlier versions remain readable. Secrets are protected by the codec.
    encryptionKey: 'airtable-workspace-manager-v1',
    schema: {
      apiToken: {
        type: 'string',
        default: '',
      },
      apiTokenEnc: {
        type: 'string',
        default: '',
      },
      lastSync: {
        type: 'string',
        default: '',
      },
      anthropicApiKey: {
        type: 'string',
        default: '',
      },
      anthropicApiKeyEnc: {
        type: 'string',
        default: '',
      },
      accounts: {
        type: 'array',
        default: [],
      },
      activeAccountId: {
        type: 'string',
        default: '',
      },
      nextAccountId: {
        type: 'number',
        default: 1,
      },
    },
  });

  // Order matters: the single-token migration reads the legacy plaintext token.
  migrateToMultiAccount();
  migrateSecretsToEncrypted();

  return store;
}

function warnPlaintextOnce() {
  if (warnedPlaintext) return;
  warnedPlaintext = true;
  logger.warn(
    'Store',
    'OS-level encryption is unavailable (for example, no system keyring). ' +
      'Saved tokens and keys are stored without encryption.',
  );
}

/**
 * Encrypt a secret for storage. Returns the `{ field, fieldEnc }` pair to persist.
 * Falls back to plaintext when encryption is unavailable or fails its round trip,
 * so a working token is never replaced by something that cannot be read back.
 */
function sealSecret(field, value) {
  const encField = `${field}Enc`;
  if (!value) return { [field]: '', [encField]: '' };

  if (codec.isAvailable()) {
    try {
      const encoded = codec.encrypt(value);
      if (codec.decrypt(encoded) === value) {
        return { [field]: '', [encField]: encoded };
      }
      logger.error('Store', `Encrypted ${field} did not round-trip; keeping it unencrypted`);
    } catch (err) {
      logger.error('Store', `Could not encrypt ${field}:`, err.message);
    }
  }

  warnPlaintextOnce();
  return { [field]: value, [encField]: '' };
}

/**
 * Read a secret from a record holding `field` and/or `fieldEnc`.
 */
function readSecret(record, field) {
  if (!record) return null;
  const encoded = record[`${field}Enc`];
  if (encoded) {
    if (codec.isAvailable()) {
      try {
        return codec.decrypt(encoded);
      } catch (err) {
        logger.error('Store', `Could not decrypt ${field}:`, err.message);
      }
    } else {
      logger.error('Store', `${field} is encrypted but OS-level encryption is unavailable`);
    }
  }
  return record[field] || null;
}

function readTopLevelSecret(field) {
  return readSecret({ [field]: store.get(field), [`${field}Enc`]: store.get(`${field}Enc`) }, field);
}

function writeTopLevelSecret(field, value) {
  store.set(sealSecret(field, value));
}

/**
 * Return a copy of an account with its token sealed. Empty slots are omitted so
 * account objects only ever carry `token` or `tokenEnc`, never both.
 */
function withAccountToken(account, token) {
  const next = { ...account };
  delete next.token;
  delete next.tokenEnc;
  const sealed = sealSecret('token', token);
  if (sealed.tokenEnc) next.tokenEnc = sealed.tokenEnc;
  if (sealed.token) next.token = sealed.token;
  return next;
}

function toPublicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    createdAt: account.createdAt,
    lastUsedAt: account.lastUsedAt,
  };
}

/**
 * If the store has a single apiToken but no accounts, migrate it.
 */
function migrateToMultiAccount() {
  const accounts = store.get('accounts') || [];
  const existingToken = readTopLevelSecret('apiToken');

  if (accounts.length === 0 && existingToken) {
    const account = withAccountToken(
      {
        id: '1',
        name: 'Default Account',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      },
      existingToken,
    );
    store.set('accounts', [account]);
    store.set('activeAccountId', '1');
    store.set('nextAccountId', 2);
    logger.info('Store', 'Migrated single token to multi-account format');
  }
}

/**
 * Encrypt any plaintext secrets left by earlier versions (or by a run where
 * encryption was unavailable) and clear the plaintext copies. Idempotent: once
 * nothing is stored in plaintext it makes no writes.
 */
function migrateSecretsToEncrypted() {
  const accounts = store.get('accounts') || [];
  // Legacy set-token only updated apiToken. Preserve that newer token on the
  // active account before encryption; encrypted top-level values are not authoritative.
  const legacyToken = store.get('apiToken');
  const activeId = store.get('activeAccountId');
  const activeAccount = accounts.find((account) => account.id === activeId);
  if (legacyToken && !store.get('apiTokenEnc') && activeAccount && activeAccount.token !== legacyToken) {
    delete activeAccount.tokenEnc;
    activeAccount.token = legacyToken;
    store.set('accounts', accounts);
  }
  const plaintextFields = TOP_LEVEL_SECRETS.filter((field) => store.get(field));
  const plaintextAccounts = accounts.some((account) => account.token);
  if (plaintextFields.length === 0 && !plaintextAccounts) return;

  if (!codec.isAvailable()) {
    warnPlaintextOnce();
    return;
  }

  for (const field of plaintextFields) {
    writeTopLevelSecret(field, store.get(field));
  }
  if (plaintextAccounts) {
    store.set(
      'accounts',
      accounts.map((account) => (account.token ? withAccountToken(account, account.token) : account)),
    );
  }
  logger.info('Store', 'Encrypted saved secrets with OS-level encryption');
}

/**
 * Get the store instance
 */
function getStore() {
  if (!store) {
    throw new Error('Store not initialized. Call createStore() first.');
  }
  return store;
}

/**
 * Last four characters of a secret, for masked display. Short values reveal nothing.
 */
function lastFour(secret) {
  if (!secret || secret.length < 12) return null;
  return secret.slice(-4);
}

/**
 * The Airtable token the app is currently using, decrypted. Main process only.
 */
function getActiveToken() {
  return readTopLevelSecret('apiToken');
}

/**
 * Save the Airtable token the app should use. Also updates the active account,
 * so switching accounts away and back keeps the new token.
 */
function setActiveToken(token) {
  writeTopLevelSecret('apiToken', token);
  const activeId = store.get('activeAccountId') || '';
  if (!activeId) return;
  const accounts = store.get('accounts') || [];
  if (!accounts.some((a) => a.id === activeId)) return;
  store.set(
    'accounts',
    accounts.map((a) => (a.id === activeId ? withAccountToken(a, token) : a)),
  );
}

function getAnthropicKey() {
  return readTopLevelSecret('anthropicApiKey');
}

function setAnthropicKey(key) {
  writeTopLevelSecret('anthropicApiKey', key);
}

/**
 * Get all accounts (never includes tokens)
 */
function getAccounts() {
  const accounts = store.get('accounts') || [];
  return accounts.map(toPublicAccount);
}

/**
 * Decrypted token for an account, or null. Main process only.
 */
function getAccountToken(id) {
  const accounts = store.get('accounts') || [];
  return readSecret(
    accounts.find((a) => a.id === id),
    'token',
  );
}

/**
 * Add a new account
 */
function addAccount(name, token) {
  const accounts = store.get('accounts') || [];
  const nextId = store.get('nextAccountId') || accounts.length + 1;
  const account = withAccountToken(
    {
      id: String(nextId),
      name,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    },
    token,
  );
  accounts.push(account);
  store.set('accounts', accounts);
  store.set('nextAccountId', nextId + 1);

  // If this is the first account, make it active
  if (accounts.length === 1) {
    store.set('activeAccountId', account.id);
    writeTopLevelSecret('apiToken', token);
  }

  return toPublicAccount(account);
}

/**
 * Remove an account by ID
 */
function removeAccount(id) {
  let accounts = store.get('accounts') || [];
  accounts = accounts.filter((a) => a.id !== id);
  store.set('accounts', accounts);

  // If the removed account was active, switch to the first remaining
  const activeId = store.get('activeAccountId');
  if (activeId === id && accounts.length > 0) {
    store.set('activeAccountId', accounts[0].id);
    writeTopLevelSecret('apiToken', readSecret(accounts[0], 'token'));
  } else if (accounts.length === 0) {
    store.set('activeAccountId', '');
    writeTopLevelSecret('apiToken', '');
  }

  return { success: true };
}

/**
 * Get the active account
 */
function getActiveAccount() {
  const activeId = store.get('activeAccountId') || '';
  if (!activeId) return null;
  const accounts = store.get('accounts') || [];
  const account = accounts.find((a) => a.id === activeId);
  return account ? toPublicAccount(account) : null;
}

/**
 * Set the active account and update lastUsedAt
 */
function setActiveAccount(id) {
  const accounts = store.get('accounts') || [];
  const account = accounts.find((a) => a.id === id);
  if (!account) {
    throw new Error(`Account ${id} not found`);
  }

  account.lastUsedAt = new Date().toISOString();
  store.set('accounts', accounts);
  store.set('activeAccountId', id);
  // Keep the active token in sync with the selected account
  writeTopLevelSecret('apiToken', readSecret(account, 'token'));

  return toPublicAccount(account);
}

module.exports = {
  createStore,
  createSafeStorageCodec,
  getStore,
  lastFour,
  getActiveToken,
  setActiveToken,
  getAnthropicKey,
  setAnthropicKey,
  getAccounts,
  getAccountToken,
  addAccount,
  removeAccount,
  getActiveAccount,
  setActiveAccount,
};
