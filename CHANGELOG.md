# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this
project uses semantic versioning once a stable release ships.

## [Unreleased]

### Added

- Animated README demo (`docs/demo.webp`) recorded from the real app on the fictional sample
  workspace: the map, a selected base with its impact view, and the change log.
- Animated explainer of how unrecorded syncs are detected (`docs/sync-detection.svg`), using a
  real pair from the sample data: two Contacts tables that score 80% and are drawn as suspected.
- `npm run capture:demo` (`scripts/capture-demo.mjs`): re-records the demo with a scripted
  cursor whenever the interface changes. It runs the app on a throwaway profile, so saved
  settings and tokens are never touched. Adds `playwright-core` as a dev dependency.

### Fixed

- `npm ci` failed on main after `@eslint/js` moved to 10 while `eslint` stayed on 9: npm refused
  the peer conflict, so lint, tests and the build all failed in CI. `@eslint/js` is back on 9,
  and Dependabot now upgrades `eslint` and `@eslint/*` together in one pull request.

### Changed

- Published as relaywright: license holder, package author and the README download link.

## [0.1.0] - 2026-10-01

First public release of Airtable Workspace Manager: a free, local-first desktop app for
visualizing and managing Airtable workspace architecture.

### Added

- Workspace map: every base laid out as a graph, with pan, zoom, and multiple layout options.
- Sync and link detection: automatically finds tables that are synced or linked across bases and
  draws the relationships as edges, with confidence scoring.
- Schema history and diffs: every refresh is compared against the last one.
- Impact analysis: upstream sources, downstream dependents, and circular dependency warnings for
  any base.
- Optional AI health check using your own Anthropic API key: base analysis, workspace-wide health
  scoring, and documentation of anti-patterns and field purposes.
- CSV, JSON, Markdown, and Mermaid diagram exports of your workspace inventory.
- Sample data mode: explore a fictional demo workspace (Cedar and Pine Goods, 15 bases) in an
  isolated database, no Airtable account required. It ships with a month of schema history, so
  the change log and health dashboard have something to show.
- Selecting a base frames it together with every base it connects to.
- Friendly permission labels (Creator, Editor, Commenter, Read only) and Escape to close dialogs.
- Multi-account support: multiple Airtable accounts, each with its own local database.
- Scheduled background refresh (hourly, daily, or weekly).
- Airtable API rate limiting with automatic retry and Retry-After handling.
- Settings can remove a saved Anthropic key.
- Backups: "Back up now" saves every record and attachment of your bases to this computer as a
  restore point, storing only what changed since the last backup. A Backups view shows each base's
  status, record and file counts, and its restore points. Sample-data mode includes a few weeks of
  example restore points.
- Installers: tagging a version builds a Windows installer, macOS disk images for Apple silicon
  and Intel, and a Linux AppImage, and attaches them to a draft GitHub Release. The installers
  are unsigned; Mac apps get an ad-hoc signature so Apple silicon Macs can open them.
- App icon: three stacked bases joined by one link, used for the installers, taskbar, and dock.

### Changed

- Logging goes through a small leveled logger: a healthy start is quiet, and debug and info
  messages only print in development.
- Lint runs with zero warnings allowed.
- Backups is labeled "Preview" in the app and the README: restoring from a backup arrives in the
  next release.

### Fixed

- The account switcher and the Settings account list now appear when you have saved accounts.
- "Save & Fetch" with a saved token leaves sample data and uses that token, including right after
  adding your first account.
- Times in the Change Log, Schema History, Workspace Health, Backups, and other screens now show
  in your own time zone. They were shifted by your UTC offset because the database stores UTC
  without a zone marker.
- Saving a token now checks it with Airtable first. A token Airtable rejects is never saved, so
  your working token stays in place. Token and connection problems are explained in plain words
  with a link to Airtable's token page, old "key..." API keys are caught before any request, and
  a token that can't see any bases gets a warning instead of an empty map.
- The tag dropdown on a base closes when you click elsewhere, press Escape, or select another
  base, so a tag can't land on the wrong base.
- The Trace Mode legend uses the same colors as the map, adds a "Traced path" entry, and the
  role colors stay on the map after a refresh.

### Security

- Renderer runs with context isolation and a strict content security policy; all Airtable and
  Anthropic API access happens through the main process, never directly from the UI.
- Airtable tokens and the Anthropic key are encrypted with the operating system's keychain
  (Electron safeStorage). Plaintext secrets saved by earlier builds are migrated on first launch.
- Saved secrets never reach the UI: Settings shows only the last four characters.
- The renderer is sandboxed, and every IPC handler rejects calls that don't come from the app's
  own page.
- Links open in the system browser only for an allowlist of https sites (Airtable and
  Anthropic); the app window never navigates away from the app. In the packaged app, only the
  app's own page counts as the app, not any other local HTML file.
- Removing an account always swaps out its Airtable connection, so a later refresh can't write
  one account's bases into another account's database.
- All database queries are parameterized.
- File exports write only to the path chosen in the operating system's save dialog.
- Local storage uses better-sqlite3 in WAL mode for durability against crashes.
