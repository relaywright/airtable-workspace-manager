// Usage from the private repo root: node scripts/release-snapshot.mjs "<empty target dir>"
// Exports committed HEAD only, creates one new commit, then checks for leaks.
// The commit is always authored and committed as the public identity below, never as the
// private repo's git user, and the script checks the finished commit before going on.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_NAME = 'relaywright';
export const PUBLIC_EMAIL = '220244294+relaywright@users.noreply.github.com';
// Git prefers these over any user.name or user.email setting.
const IDENTITY_ENV = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const PRIVATE_PATHS = ['_local-archive', 'docs/superpowers', 'artifacts', '.claude', 'VISION.md'];
// Tracked in the private repo but meaningless (and revealing) in a one-commit public repo:
// .gitleaksignore lists findings by private-history commit SHA.
const DROP_PATHS = ['.gitleaksignore'];
const TOKEN_RE = /pat[A-Za-z0-9]{14}\.[a-f0-9]{64}|\bkey[A-Za-z0-9]{14}\b/;
const COMMIT_MESSAGE =
  'Initial public release of Airtable Workspace Manager\n\n' +
  'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>';
const DOCKER_MESSAGE = 'Docker is not running. Start Docker Desktop, then run this again.';

function run(command, args, cwd, message, stdio = 'pipe', env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code || result.signal || `exit ${result.status}`;
    throw new Error(`${message} (${reason})`);
  }
  return result.stdout || '';
}

/** Names of git identity variables in env that would put someone else on the commit. */
export function identityOverrides(env) {
  const expected = {
    GIT_AUTHOR_NAME: PUBLIC_NAME,
    GIT_AUTHOR_EMAIL: PUBLIC_EMAIL,
    GIT_COMMITTER_NAME: PUBLIC_NAME,
    GIT_COMMITTER_EMAIL: PUBLIC_EMAIL,
  };
  return IDENTITY_ENV.filter((key) => env[key] !== undefined && env[key] !== expected[key]);
}

/** The environment for the snapshot commit: the public identity, set explicitly. */
export function snapshotCommitEnv(env) {
  return {
    ...env,
    GIT_AUTHOR_NAME: PUBLIC_NAME,
    GIT_AUTHOR_EMAIL: PUBLIC_EMAIL,
    GIT_COMMITTER_NAME: PUBLIC_NAME,
    GIT_COMMITTER_EMAIL: PUBLIC_EMAIL,
  };
}

/** Author and committer recorded in a raw commit object (`git cat-file commit`). */
export function commitIdentities(rawCommit) {
  const end = rawCommit.indexOf('\n\n');
  const header = (end === -1 ? rawCommit : rawCommit.slice(0, end)).split('\n');
  const identities = {};
  for (const role of ['author', 'committer']) {
    const lines = header.filter((line) => line.startsWith(`${role} `));
    const match = lines.length === 1 && /^\w+ (.*) <([^<>]*)> \d+ [+-]\d{4}$/.exec(lines[0]);
    identities[role] = match ? { name: match[1], email: match[2] } : null;
  }
  return identities;
}

/**
 * Commits what is staged in `target` as the public identity, then checks the result.
 * Hooks are switched off (pointed at a folder that must not exist), so no global, system or
 * template hook can amend the commit or plant a replacement for it.
 */
export function commitSnapshot(target, message, env) {
  const noHooks = path.join(target, '.git', 'no-hooks');
  if (fs.lstatSync(noHooks, { throwIfNoEntry: false })) {
    throw new Error(`${noHooks} exists, so Git hooks could run on the snapshot commit. Start over.`);
  }
  run(
    'git',
    ['-C', target, '-c', `core.hooksPath=${noHooks}`, 'commit', '--no-gpg-sign', '-m', message],
    target,
    'Cannot create the snapshot commit.',
    'pipe',
    snapshotCommitEnv(env),
  );
  verifySnapshotIdentity(target);
}

/** Throws unless HEAD's real commit object (replacement refs ignored) names only the public identity. */
export function verifySnapshotIdentity(target) {
  const identities = commitIdentities(
    run(
      'git',
      ['--no-replace-objects', '-C', target, 'cat-file', 'commit', 'HEAD'],
      target,
      'Cannot read the snapshot commit.',
    ),
  );
  for (const role of ['author', 'committer']) {
    const who = identities[role];
    if (!who || who.name !== PUBLIC_NAME || who.email !== PUBLIC_EMAIL) {
      throw new Error(`The snapshot commit's ${role} is not ${PUBLIC_NAME} <${PUBLIC_EMAIL}>.`);
    }
  }
}

function assertAbsent(target, paths) {
  for (const relative of paths) {
    if (fs.lstatSync(path.join(target, relative), { throwIfNoEntry: false })) {
      throw new Error(`Snapshot contains a forbidden path: ${relative}. Remove it from tracked HEAD.`);
    }
  }
}

function scanTokens(target, relative = '') {
  let fileCount = 0;
  let matchCount = 0;
  for (const entry of fs.readdirSync(path.join(target, relative), {
    withFileTypes: true,
  })) {
    if (!relative && entry.name === '.git') continue;
    const file = path.join(relative, entry.name);
    const absolute = path.join(target, file);
    if (entry.isDirectory()) {
      const result = scanTokens(target, file);
      fileCount += result.fileCount;
      matchCount += result.matchCount;
    } else if (entry.isFile()) {
      fileCount++;
      const contents = fs.readFileSync(absolute);
      if (contents.subarray(0, 8000).includes(0)) continue;
      const lines = contents.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (TOKEN_RE.test(lines[i])) {
          console.log(`${file.split(path.sep).join('/')}:${i + 1}`);
          matchCount++;
        }
      }
    } else {
      throw new Error(`Cannot safely scan ${file}. Replace symbolic links or special files first.`);
    }
  }
  return { fileCount, matchCount };
}

function main() {
  if (process.argv.length !== 3 || !process.argv[2].trim()) {
    throw new Error('Usage: node scripts/release-snapshot.mjs "<empty target dir>"');
  }
  const overrides = identityOverrides(process.env);
  if (overrides.length > 0) {
    throw new Error(
      `${overrides.join(', ')} would put another identity on the public commit. ` +
        `Unset ${overrides.length === 1 ? 'it' : 'them'} and run this again.`,
    );
  }
  const source = process.cwd();
  const target = path.resolve(process.argv[2]);
  const prefix = run('git', ['rev-parse', '--show-prefix'], source, 'Cannot locate the private repo.');
  if (prefix.trim()) throw new Error('Run this script from the private repo root.');
  const status = run(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    source,
    'Cannot check the private working tree.',
  );
  if (status.trim()) {
    throw new Error('The private working tree has uncommitted changes. Commit or clear them first.');
  }
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || fs.readdirSync(target).length > 0)) {
    throw new Error('The target must be a missing folder or an empty existing folder.');
  }
  fs.mkdirSync(target, { recursive: true });

  console.log('Exporting tracked files from HEAD...');
  // The archive sits inside the target and tar gets no paths: Git for Windows puts GNU tar
  // first on PATH, and it misreads any "C:\..." argument as a remote host.
  const archiveName = '.release-snapshot-export.tar';
  const archive = path.join(target, archiveName);
  try {
    run(
      'git',
      ['archive', '--format=tar', '--output', archive, 'HEAD'],
      source,
      'Cannot export HEAD. Check that the private repo has a commit.',
    );
    run('tar', ['-xf', archiveName], target, 'Cannot extract the snapshot. Check tar is installed.');
  } finally {
    fs.rmSync(archive, { force: true });
  }
  for (const relative of DROP_PATHS) fs.rmSync(path.join(target, relative), { force: true });
  assertAbsent(target, [...PRIVATE_PATHS, ...DROP_PATHS, '.git']);

  console.log('Creating the one-commit snapshot repo...');
  // No template: nothing from a configured template folder (hooks included) is copied in.
  run(
    'git',
    ['-C', target, 'init', '--template=', '-b', 'main'],
    source,
    'Cannot initialize the snapshot repo.',
  );
  for (const [key, value] of [
    ['user.name', PUBLIC_NAME],
    ['user.email', PUBLIC_EMAIL],
  ]) {
    run('git', ['-C', target, 'config', '--local', key, value], source, `Cannot set snapshot ${key}.`);
  }
  // Force inclusion of tracked HEAD files even if an ignore rule also matches them.
  run('git', ['-C', target, 'add', '--all', '--force', '--', '.'], source, 'Cannot stage snapshot files.');
  commitSnapshot(target, COMMIT_MESSAGE, process.env);
  const commitCount = run(
    'git',
    ['--no-replace-objects', '-C', target, 'rev-list', '--count', 'HEAD'],
    source,
    'Cannot verify snapshot history.',
  ).trim();
  if (commitCount !== '1') throw new Error('Snapshot history must contain exactly one commit.');

  console.log('Running check-clean with the local denylist...');
  const localDirectory = path.join(target, '_local-archive');
  const localDenylist = path.join(localDirectory, 'denylist.local.sha256.txt');
  fs.mkdirSync(localDirectory);
  try {
    fs.copyFileSync(path.join(source, '_local-archive', 'denylist.local.sha256.txt'), localDenylist);
    run(
      'git',
      ['-C', target, 'check-ignore', '--quiet', '--', '_local-archive/denylist.local.sha256.txt'],
      source,
      'The snapshot must ignore the local denylist. Add _local-archive/ to .gitignore first.',
    );
    const result = spawnSync(process.execPath, ['scripts/check-clean.mjs'], {
      cwd: target,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (
      result.error ||
      result.status !== 0 ||
      !/^check-clean: OK \([^\r\n]*local denylist: loaded\)\r?$/m.test(result.stdout || '')
    ) {
      throw new Error('check-clean failed or did not confirm the local denylist was loaded.');
    }
  } finally {
    fs.rmSync(localDenylist, { force: true });
    if (fs.readdirSync(localDirectory).length === 0) fs.rmdirSync(localDirectory);
  }

  console.log('Scanning snapshot files for token shapes...');
  const { fileCount, matchCount } = scanTokens(target);
  if (matchCount > 0) throw new Error('Token-shape scan failed. Review the file locations listed above.');

  console.log('Running Gitleaks through Docker...');
  const docker = spawnSync('docker', ['info'], {
    cwd: source,
    stdio: 'ignore',
  });
  if (docker.error || docker.status !== 0) throw new Error(DOCKER_MESSAGE);
  run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${target}:/repo`,
      'zricethezav/gitleaks:latest',
      'git',
      '/repo',
      '--redact',
      '--exit-code',
      '1',
    ],
    source,
    'Gitleaks failed. Review its redacted output above before using this snapshot.',
    'inherit',
  );
  const sha = run(
    'git',
    ['-C', target, 'rev-parse', 'HEAD'],
    source,
    'Cannot read the snapshot commit.',
  ).trim();
  console.log(`Snapshot: ${fileCount} files, commit ${sha}`);
  console.log('all checks passed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    console.error('Any existing target folder has been kept for inspection.');
    process.exitCode = 1;
  }
}
