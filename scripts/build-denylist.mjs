// Local-use-only tool: builds the two-tier hashed denylist consumed by
// check-clean.mjs. It never writes plain terms anywhere and never prints them.
//
// Airtable-ID-shaped strings (from _local-archive/docs/sample-schema.json and
// from CLI args) are hashed into the tracked, public file
// scripts/denylist.sha256.txt. Everything else passed on the CLI (short
// words, names) is hashed into the gitignored, local-only file
// _local-archive/denylist.local.sha256.txt, because a hash of a short/guessable
// string can be reversed by brute force and must never be published.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashToken } from './check-clean.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const ID_WHOLE_RE = /^(app|tbl|fld|viw|rec|sel|usr|wsp)[A-Za-z0-9]{14}$/;

// '#' lines are the file's header comment: kept in order at the top, never sorted
// in with the hashes.
function readExistingLines(filePath) {
  if (!fs.existsSync(filePath)) return { header: [], hashes: new Set() };
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    header: lines.filter((line) => line.startsWith('#')),
    hashes: new Set(lines.filter((line) => !line.startsWith('#'))),
  };
}

function writeSortedHashes(filePath, header, hashSet) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [...header, ...[...hashSet].sort()];
  fs.writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''));
}

// Walks a parsed schema object/array and collects only STRING VALUES that whole-match
// the Airtable ID shape. Object keys are never harvested, even when a key name happens
// to look ID-shaped (e.g. the real Airtable API option name `recordLinkFieldId`, which
// is coincidentally "rec" + 14 letters as a KEY, not a value).
export function harvestIds(schemaValue) {
  const ids = new Set();

  function walk(value) {
    if (typeof value === 'string') {
      if (ID_WHOLE_RE.test(value)) ids.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) walk(value[key]);
    }
  }

  walk(schemaValue);
  return ids;
}

function collectIdsFromSampleSchema() {
  const samplePath = path.join(REPO_ROOT, '_local-archive', 'docs', 'sample-schema.json');
  if (!fs.existsSync(samplePath)) return [];
  const schema = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  return [...harvestIds(schema)];
}

// Splits a multi-word term into the individual tokens check-clean's scanText
// would need to match against, since scanText only ever tests single words
// (and their camelCase/punctuation-split parts) against the denylist -- it
// never hashes a whole multi-word phrase. check-clean doesn't export a
// reusable tokenizer, so this mirrors its rule: split on whitespace and on
// '.'/',' punctuation.
function tokenizeTerm(term) {
  return term
    .split(/[\s.,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function buildDenylists({ cliArgs = [], repoRoot = REPO_ROOT, rebuild = false } = {}) {
  const publicPath = path.join(repoRoot, 'scripts', 'denylist.sha256.txt');
  const localPath = path.join(repoRoot, '_local-archive', 'denylist.local.sha256.txt');

  // The local tier always merges with whatever is already there, so a rebuild of the
  // public tier never drops locally-added terms. Only the public tier can be rebuilt
  // from scratch, since it is the one a stray non-ID hash could have polluted.
  const publicExisting = readExistingLines(publicPath);
  const localExisting = readExistingLines(localPath);
  const publicHashes = rebuild ? new Set() : publicExisting.hashes;
  const localHashes = localExisting.hashes;

  for (const id of collectIdsFromSampleSchema()) {
    publicHashes.add(hashToken(id));
  }

  let tokensAdded = 0;
  for (const term of cliArgs) {
    if (!term) continue;
    if (ID_WHOLE_RE.test(term)) {
      publicHashes.add(hashToken(term));
    } else {
      localHashes.add(hashToken(term));
      // A multi-word term (e.g. "Acme Corp") is never hashed as a single
      // unit by check-clean, so a whole-term hash alone would never match
      // anything there. Also add per-token hashes so each individual word
      // is caught.
      for (const token of tokenizeTerm(term)) {
        if (token.length >= 3) {
          localHashes.add(hashToken(token));
          tokensAdded++;
        }
      }
    }
  }

  writeSortedHashes(publicPath, publicExisting.header, publicHashes);
  writeSortedHashes(localPath, localExisting.header, localHashes);

  return {
    publicCount: publicHashes.size,
    localCount: localHashes.size,
    tokensAdded,
  };
}

function main() {
  const rawArgs = process.argv.slice(2);
  const rebuild = rawArgs.includes('--rebuild');
  const cliArgs = rawArgs.filter((arg) => arg !== '--rebuild');
  const { publicCount, localCount, tokensAdded } = buildDenylists({ cliArgs, rebuild });
  console.log(
    `denylist: public=${publicCount} hashes, local=${localCount} hashes (${tokensAdded} word tokens added this run)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
