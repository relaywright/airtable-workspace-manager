// Usage from the private repo root: node scripts/release-snapshot.mjs "<empty target dir>"
// Exports committed HEAD only, creates one new commit, then checks for leaks.
// Set SNAPSHOT_AUTHOR_EMAIL (e.g. a GitHub noreply address) to keep your git email out of
// the public commit; otherwise the private repo's user.email is used.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PRIVATE_PATHS = ['_local-archive', 'docs/superpowers', 'artifacts', '.claude', 'VISION.md'];
// Tracked in the private repo but meaningless (and revealing) in a one-commit public repo:
// .gitleaksignore lists findings by private-history commit SHA.
const DROP_PATHS = ['.gitleaksignore'];
const TOKEN_RE = /pat[A-Za-z0-9]{14}\.[a-f0-9]{64}|\bkey[A-Za-z0-9]{14}\b/;
const COMMIT_MESSAGE =
  'Initial public release of Airtable Workspace Manager\n\n' +
  'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>';
const DOCKER_MESSAGE = 'Docker is not running. Start Docker Desktop, then run this again.';

function run(command, args, cwd, message, stdio = 'pipe') {
  const result = spawnSync(command, args, {
    cwd,
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
  for (const entry of fs.readdirSync(path.join(target, relative), { withFileTypes: true })) {
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
  run('git', ['-C', target, 'init', '-b', 'main'], source, 'Cannot initialize the snapshot repo.');
  const overrides = { 'user.email': process.env.SNAPSHOT_AUTHOR_EMAIL?.trim() };
  for (const key of ['user.name', 'user.email']) {
    if (overrides[key]) {
      run(
        'git',
        ['-C', target, 'config', '--local', key, overrides[key]],
        source,
        `Cannot set snapshot ${key}.`,
      );
      continue;
    }
    const value = run(
      'git',
      ['config', '--get', key],
      source,
      `Set ${key} in the private repo first.`,
    ).trim();
    if (!value) throw new Error(`Set ${key} in the private repo first.`);
    run('git', ['-C', target, 'config', '--local', key, value], source, `Cannot set snapshot ${key}.`);
  }
  // Force inclusion of tracked HEAD files even if an ignore rule also matches them.
  run('git', ['-C', target, 'add', '--all', '--force', '--', '.'], source, 'Cannot stage snapshot files.');
  run(
    'git',
    ['-C', target, 'commit', '--no-gpg-sign', '-m', COMMIT_MESSAGE],
    source,
    'Cannot create the snapshot commit.',
  );
  const commitCount = run(
    'git',
    ['-C', target, 'rev-list', '--count', 'HEAD'],
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
  const docker = spawnSync('docker', ['info'], { cwd: source, stdio: 'ignore' });
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

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error('Any existing target folder has been kept for inspection.');
  process.exitCode = 1;
}
