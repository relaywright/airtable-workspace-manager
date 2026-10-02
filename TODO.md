# TODO

## Now

Foundation is done: naming convention generalized into a setting, storage moved to better-sqlite3, Electron and dependencies upgraded, sample-data demo mode added, CI made honest (real lint, format, clean-repo, and cross-platform test gates). No leftover Foundation items.

## Next: first public release (v0.1)

Decided 2026-10-01: launch soon with Backups labeled as a preview (restore comes in a later release), and ship unsigned installers with clear step-by-step install instructions.

- [x] Downloadable installers: a release workflow that builds Windows, macOS, and Linux installers and attaches them to a GitHub Release.
- [x] App icon.
- [x] Backups labeled "Preview" in the app and README, saying restore comes next.
- [x] README install steps for each system, including how to get past the unsigned-app warning, replacing the run-from-source quick start.
- [x] First-run polish: a friendlier message when Airtable rejects a token, and change log times shown in local time.
- [x] Known issues: tag dropdown outside click, trace-mode legend colors, Cytoscape cleanup on navigation (already fixed; the schema map now also clears its reference).
- [x] Repo page: description, topics, homepage link.
- [x] Publish v0.1.0 as a one-commit public repository that passes gitleaks, `check:clean`, and a scan for Airtable token shapes.

## After v0.1: Backup & restore

Scheduled, incremental backups of every record and attachment, with a preview-before-you-commit restore flow and full undo.

- [x] Plan 1A: backup engine (incremental record and attachment backups), "Back up now", the Backups view, and demo restore points.
- [ ] Plan 1B: scheduled backups and tray icon, catch-up after missed runs, backup folder choice with a cloud-sync warning, retention, verify, export, Settings → Backups, and a token scope check.
- [ ] Plan 1C: restore (preview before you commit, and undo).

## Later

- Data quality: duplicate detection, empty/unused fields, broken links, workspace health score.
- Write tools: bulk edit, cross-base sync, merge duplicates, each preceded by an automatic snapshot so it can be undone.
- Signed installers for macOS and Windows (v0.1 ships unsigned).
- Change Log rows: show a short diff summary in the collapsed row, not just "Schema snapshot at ...".
- Markdown export: use the friendly permission labels (it prints raw values like `create`).
- Split the largest components (`WorkspaceMap.jsx`, `SetupModal.jsx`) and add a shared icon component.
- Clear the remaining React `act()` test warnings in `App.test.jsx`, `BaseDetailPanel.test.jsx`, and `DemoBanner.test.jsx` (same pattern already fixed in `SetupModal.test.jsx`).

## Known open issues

- Edits made during a running refresh share its long-lived transaction and are discarded if the refresh rolls back (`electron/services/refresh.js`, `database.js` batch). Scheduled for Plan 1B: fetch first, then write results in one synchronous transaction.
