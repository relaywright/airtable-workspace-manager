import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const APP_ORIGIN = 'http://localhost:5174';

function registerWithFakeIpc() {
  const { registerAll } = require('./index.js');
  const handlers = new Map();
  const seen = [];
  const fakeIpc = {
    handle: (ch, fn) => {
      seen.push(ch);
      handlers.set(ch, fn);
    },
  };
  registerAll(fakeIpc, {
    appOrigin: APP_ORIGIN,
    store: { get() {}, set() {} },
    electron: { dialog: {}, shell: {}, app: {} },
    demoMode: { isActive: () => false },
  });
  return { seen, handlers };
}

describe('ipc registerAll', () => {
  it('registers every channel preload exposes, exactly once', () => {
    const { seen } = registerWithFakeIpc();
    const fs = require('fs');
    const preload = fs.readFileSync(require.resolve('../preload.js'), 'utf8');
    const exposed = [...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
    expect(new Set(seen)).toEqual(new Set(exposed));
    expect(seen.length).toBe(new Set(seen).size);
  });

  it('runs handlers for the app page and rejects any other sender', async () => {
    const { handlers } = registerWithFakeIpc();
    const isDemoMode = handlers.get('is-demo-mode');

    const trusted = { senderFrame: { url: `${APP_ORIGIN}/` } };
    expect(await isDemoMode(trusted)).toBe(false);

    expect(() => isDemoMode({ senderFrame: { url: 'https://evil.example.com/' } })).toThrow(
      /untrusted sender/,
    );
    expect(() => isDemoMode({ senderFrame: null })).toThrow(/untrusted sender/);
  });

  it('refuses to register without an app origin', () => {
    const { registerAll } = require('./index.js');
    expect(() => registerAll({ handle() {} }, {})).toThrow(/appOrigin/);
  });
});
