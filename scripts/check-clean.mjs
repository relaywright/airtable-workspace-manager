// Clean-repo guard: scans tracked files for denylisted terms and Airtable IDs
// without ever printing the plain terms themselves. Terms are compared as
// 16-hex-char SHA-256 prefixes (case-insensitive on the raw term).
//
// Two-tier denylist:
//   - scripts/denylist.sha256.txt (tracked, public): hashes of Airtable-ID-shaped
//     strings only. A 14-char random ID has enough entropy that a hash of it
//     cannot be reversed by brute force, so it is safe to publish.
//   - _local-archive/denylist.local.sha256.txt (gitignored, local only): hashes
//     of everything else (short words, names). Short words are reversible from
//     a hash (brute-forcing every dictionary word/short string takes
//     milliseconds), so those hashes never leave this machine.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORD_RE = /[A-Za-z][A-Za-z0-9&'-]{1,40}/g;
const ID_RE = /\b(app|tbl|fld|viw|rec|sel|usr|wsp)[A-Za-z0-9]{14}\b/g;
const ID_WHOLE_RE = /^(app|tbl|fld|viw|rec|sel|usr|wsp)[A-Za-z0-9]{14}$/;
const CAMEL_SPLIT_RE = /[A-Z]+[a-z0-9]*|[a-z0-9]+/g;
const BINARY_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'icns',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'zip',
]);
const SKIP_FILES = new Set(['package-lock.json', 'scripts/denylist.sha256.txt']);

export function hashToken(token) {
  return createHash('sha256').update(token.toLowerCase()).digest('hex').slice(0, 16);
}

function partsOf(word) {
  // Split on -, ', & (already excluded from camelCase parts since those are
  // punctuation), then camelCase/PascalCase-split each part.
  const parts = new Set([word]);
  const subParts = word.split(/[-'&]/).filter(Boolean);
  for (const sub of subParts) {
    parts.add(sub);
    const camel = sub.match(CAMEL_SPLIT_RE) || [];
    for (const c of camel) parts.add(c);
  }
  return [...parts];
}

export function scanText(text, denySet) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    for (const match of line.matchAll(ID_RE)) {
      const token = match[0];
      if (denySet.has(hashToken(token))) {
        findings.push({ token, line: lineNo });
      }
    }

    for (const match of line.matchAll(WORD_RE)) {
      const word = match[0];
      if (ID_WHOLE_RE.test(word)) continue; // IDs are checked whole only, never split
      for (const part of partsOf(word)) {
        if (part.length < 2) continue;
        if (denySet.has(hashToken(part))) {
          findings.push({ token: part, line: lineNo });
          break;
        }
      }
    }
  }
  return findings;
}

export function loadDenySet(paths) {
  const denySet = new Set();
  for (const p of paths) {
    if (!p || !fs.existsSync(p)) continue;
    const contents = fs.readFileSync(p, 'utf8');
    for (const rawLine of contents.split('\n')) {
      const hash = rawLine.trim();
      if (hash && !hash.startsWith('#')) denySet.add(hash);
    }
  }
  return denySet;
}

function isBinaryFile(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return BINARY_EXTS.has(ext);
}

// Scans `files` for denylisted content using the injected `readFile(file) -> string`
// reader. `readFile` is expected to throw a Node-style error with a `.code` property
// on failure. An ENOENT (file deleted in the working tree after `git ls-files` listed
// it) is not a scan failure and is counted in `skipped`. Any other read error (EACCES,
// EISDIR, EBUSY, ...) means the guard could not verify that file's contents, so it is
// recorded in `unreadable` with its error code rather than being silently passed over.
export function scanFiles(files, denySet, readFile) {
  const findings = [];
  const skipped = [];
  const unreadable = [];

  for (const file of files) {
    let text;
    try {
      text = readFile(file);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        skipped.push(file);
      } else {
        unreadable.push({ file, code: (err && err.code) || 'UNKNOWN' });
      }
      continue;
    }

    for (const finding of scanText(text, denySet)) {
      findings.push({ file, line: finding.line, hash: hashToken(finding.token) });
    }
  }

  return { findings, skipped, unreadable };
}

export function scanRepo({ cwd, denylistPath, localDenylistPath }) {
  const files = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);

  const denySet = loadDenySet([denylistPath, localDenylistPath]);

  const scannable = files.filter((file) => !SKIP_FILES.has(file) && !isBinaryFile(file));
  const readFile = (file) => fs.readFileSync(path.join(cwd, file), 'utf8');

  const { findings, skipped, unreadable } = scanFiles(scannable, denySet, readFile);

  return {
    findings,
    skipped,
    unreadable,
    fileCount: files.length,
    localDenylistLoaded: !!localDenylistPath && fs.existsSync(localDenylistPath),
  };
}

function main() {
  const cwd = process.cwd();
  const denylistPath = path.join(cwd, 'scripts', 'denylist.sha256.txt');
  const localDenylistPath = path.join(cwd, '_local-archive', 'denylist.local.sha256.txt');

  const { findings, skipped, unreadable, fileCount, localDenylistLoaded } = scanRepo({
    cwd,
    denylistPath,
    localDenylistPath,
  });

  for (const f of findings) {
    console.log(`${f.file}:${f.line} (${f.hash})`);
  }

  for (const u of unreadable) {
    console.log(`${u.file}: cannot read (${u.code})`);
  }

  if (unreadable.length > 0) {
    process.exit(2);
  } else if (findings.length > 0) {
    process.exit(1);
  } else {
    const localStatus = localDenylistLoaded ? 'loaded' : 'not found';
    const skippedNote = skipped.length > 0 ? `, ${skipped.length} skipped: deleted in working tree` : '';
    console.log(`check-clean: OK (${fileCount} files${skippedNote}, local denylist: ${localStatus})`);
    process.exit(0);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
