# Contributing

Thanks for considering a contribution to Airtable Workspace Manager.

## Prerequisites

- Node.js 22 or newer
- npm

## Setup

```bash
npm install
npm run dev
```

This starts the Vite dev server and the Electron app together.

## Before you open a pull request

Run these locally; all of them run in CI too:

```bash
npm run lint
npm run format:check
npm test
npm run check:clean
```

`npm run build` if you touched build config, `vite.config.js`, or `package.json`.

## Testing philosophy

Tests are limited to end-to-end and critical smoke coverage. We don't add unit tests for their
own sake: prefer a test that exercises real behavior through the app over one that pins down an
implementation detail.

## Sample data

Any sample or fixture data must live under `fixtures/demo-workspace` (the fictional "Cedar and
Pine Goods" demo workspace). Never commit real Airtable workspace data, screenshots of real
bases, or tokens.

## About `npm run check:clean`

This repo carries a local, best-effort guard that hashes tracked file content against a
denylist of identifiers from a private workspace this project used to be built against. It is
not a general secret scanner and does not catch everything; it exists to keep specific known
identifiers from re-entering the repo.

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`,
`docs:`, `test:`, `refactor:`), describing why a change was made, not just what changed.
