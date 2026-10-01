# CLAUDE.md: instructions for AI coding agents

## Project context

An Electron desktop app for visualizing and managing Airtable workspace architecture. Many users are not technical, so the app must be polished and easy to use.

Read `TODO.md` for current priorities and `README.md` for what the app does today. Don't rely on this file for project status.

## How to work

Work in small, end-to-end slices: get one piece working in the Electron app (not just in Node), commit it, then start the next.

## Architecture

### Electron

- Context isolation on, Node integration off, renderer sandboxed. `electron/preload.js` may only use `contextBridge` and `ipcRenderer`.
- Main process owns SQLite, the file system, secrets, and all Airtable and Anthropic API calls. The renderer is React UI only and talks to main through IPC (`window.api.*`).
- `electron/main.js` is lifecycle only: window creation, app events, scheduler wiring.
- IPC handlers live in `electron/ipc/<feature>.js`, one module per feature, each exporting `register(ipcMain, ctx)`. `registerAll()` in `electron/ipc/index.js` registers them through a wrapper that rejects calls not coming from the app's own page, so new handlers get that check for free.
- Links open in the system browser only if `isAllowedExternalUrl()` in `electron/externalLinks.js` allows them. The app window never navigates away from the app.

### Secrets

- Airtable tokens and the Anthropic key are encrypted with Electron `safeStorage` through `electron/store.js`. Read and write them only through its helpers (`getActiveToken`, `setActiveToken`, `getAnthropicKey`, `setAnthropicKey`, `getAccountToken`).
- Never send a saved secret to the renderer. The UI gets `{ hasToken, last4 }`-style summaries only.
- Never put secrets in `localStorage`, logs, or test fixtures.

### Database

- `better-sqlite3` with `journal_mode = WAL` and `synchronous = NORMAL`. Batch writes use real transactions. All queries are parameterized.
- Store full schema JSON and parse it on read. Every record has timestamps for change tracking.

### State and styling

- React Context for global app state, local component state for UI concerns. No Redux.
- Tailwind CSS, dark theme by default. Palette: background `#0f0f1a`, surface `#1a1a2e`, accent `#6366f1`, text `#e2e8f0`, muted `#64748b`.
- Functional components with hooks, named exports, props destructuring.

## Rules

1. **Use only the sample data.** `fixtures/demo-workspace` (the fictional "Cedar & Pine Goods" workspace) is the only data for development, tests, and screenshots. Never commit data from a real Airtable workspace.
2. **Run `npm run check:clean` before committing.** It hashes tracked files against a denylist of private identifiers and fails on a match. It is also a CI gate.
3. **Respect Airtable's rate limit** (5 requests per second). Go through `electron/airtableClient.js`, which handles limits and Retry-After.
4. **Use Airtable's IDs** for bases, tables, and fields. Never generate your own.
5. **Keep the UI responsive** during API calls: show loading states and never block on a request.
6. **No em dashes in user-facing text** (UI strings, README, docs). Use colons, commas, or separate sentences.

## Testing

- Tests cover end-to-end and critical smoke paths only. Don't add unit tests for their own sake.
- `npm test` runs the Vitest renderer suite, then `npm run test:electron` (the main-process suite under `ELECTRON_RUN_AS_NODE=1`, so native modules match the app's build).
- CI gates, run locally before committing: `npm run lint`, `npm run format:check`, `npm run check:clean`, `npm test`.

```bash
npm install      # install dependencies
npm run dev      # run the app in development
npm run build    # build the installer
```

Stop `npm run dev` before `npm run build` on Windows: the dev server's file watcher can lock the packaging folder (EPERM on rename).

## References

- Airtable API: https://airtable.com/developers/web/api/get-base-schema
- Cytoscape.js: https://js.cytoscape.org/
- Electron: https://www.electronjs.org/docs/latest/
- If a library misbehaves, check whether it belongs in the main or renderer process.
