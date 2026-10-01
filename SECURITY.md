# Security Policy

## Supported Versions

Only the latest released version is supported with security fixes.

## Reporting a Vulnerability

Please do not open a public issue for security reports. Use GitHub's private vulnerability
reporting instead: go to the repository's "Security" tab and click "Report a vulnerability."
This opens a private conversation with the maintainers.

## Scope

Things we consider in scope for security reports:

- How Airtable and Anthropic API tokens are stored and handled
- The IPC surface between the Electron renderer and main process
- File write behavior (exports, backups, database files)
- How Airtable schema content is rendered in the UI

Please include steps to reproduce and, if possible, the smallest example that shows the issue.
