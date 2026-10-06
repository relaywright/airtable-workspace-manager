import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_NAME,
  PUBLIC_EMAIL,
  identityOverrides,
  snapshotCommitEnv,
  commitIdentities,
  commitSnapshot,
  verifySnapshotIdentity,
} from './release-snapshot.mjs';

// Made-up identity, never a real one.
const OTHER_NAME = 'Someone Else';
const OTHER_EMAIL = 'someone@example.com';
const OTHER_ENV = {
  GIT_AUTHOR_NAME: OTHER_NAME,
  GIT_AUTHOR_EMAIL: OTHER_EMAIL,
  GIT_COMMITTER_NAME: OTHER_NAME,
  GIT_COMMITTER_EMAIL: OTHER_EMAIL,
};
const SCRIPT = fileURLToPath(new URL('./release-snapshot.mjs', import.meta.url));
const PUBLIC = { name: PUBLIC_NAME, email: PUBLIC_EMAIL };

describe('release-snapshot identity', () => {
  const dirs = [];
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-snapshot-test-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      // Git marks its object files read-only, and Windows refuses to delete read-only files.
      for (const entry of fs.readdirSync(dir, { recursive: true })) {
        const file = path.join(dir, entry);
        if (fs.lstatSync(file).isFile()) fs.chmodSync(file, 0o666);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  // A temp repo whose own git config names someone else.
  const repo = () => {
    const dir = tempDir();
    const git = (args, env = process.env) => {
      const result = spawnSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        env,
      });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout;
    };
    git(['init', '-q']);
    git(['config', 'user.name', OTHER_NAME]);
    git(['config', 'user.email', OTHER_EMAIL]);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(['add', 'a.txt']);
    return { dir, git };
  };

  it('flags git identity variables that name anyone else', () => {
    const env = {
      GIT_AUTHOR_EMAIL: OTHER_EMAIL,
      GIT_COMMITTER_NAME: OTHER_NAME,
      PATH: 'unrelated',
    };
    expect(identityOverrides(env)).toEqual(['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME']);
  });

  it('accepts no identity variables, or ones that already name the public identity', () => {
    expect(identityOverrides({})).toEqual([]);
    expect(identityOverrides(snapshotCommitEnv({}))).toEqual([]);
  });

  it('reads author and committer from the commit header, not the message', () => {
    const raw =
      `tree ${'a'.repeat(40)}\n` +
      `author ${PUBLIC_NAME} <${PUBLIC_EMAIL}> 1790000000 -0400\n` +
      `committer ${OTHER_NAME} <${OTHER_EMAIL}> 1790000000 +0000\n\n` +
      `author Fake <fake@example.com> 1 +0000\n`;
    expect(commitIdentities(raw)).toEqual({
      author: PUBLIC,
      committer: { name: OTHER_NAME, email: OTHER_EMAIL },
    });
  });

  it('treats a missing or repeated identity line as unknown', () => {
    const repeated = 'tree x\nauthor A <a@example.com> 1 +0000\nauthor B <b@example.com> 1 +0000\n\nm';
    expect(commitIdentities(repeated).author).toBeNull();
    expect(commitIdentities('tree x\n\nmessage').committer).toBeNull();
  });

  it('commits as the public identity even when git config names someone else', () => {
    const { dir, git } = repo();
    commitSnapshot(dir, 'test', process.env);

    expect(commitIdentities(git(['cat-file', 'commit', 'HEAD']))).toEqual({
      author: PUBLIC,
      committer: PUBLIC,
    });
  });

  it('runs no git hook while committing, even one set in git config', () => {
    const { dir, git } = repo();
    // A post-commit hook that would re-sign the commit as someone else and leave a marker.
    const hooks = path.join(dir, 'hooks');
    fs.mkdirSync(hooks);
    const hook = path.join(hooks, 'post-commit');
    const resign = Object.entries(OTHER_ENV)
      .map(([key, value]) => `${key}='${value}'`)
      .join(' ');
    fs.writeFileSync(
      hook,
      '#!/bin/sh\n[ -e hook-ran ] && exit 0\ntouch hook-ran\n' +
        `${resign} git commit -q --amend --no-edit --reset-author\n`,
    );
    fs.chmodSync(hook, 0o755);
    git(['config', 'core.hooksPath', hooks]);

    commitSnapshot(dir, 'test', process.env);

    expect(fs.existsSync(path.join(dir, 'hook-ran'))).toBe(false);
    expect(commitIdentities(git(['cat-file', 'commit', 'HEAD'])).author).toEqual(PUBLIC);
  });

  it('refuses to commit when something already put hooks where hooks are switched off', () => {
    const { dir } = repo();
    // What a Git template folder containing no-hooks/post-commit would leave behind.
    const planted = path.join(dir, '.git', 'no-hooks');
    fs.mkdirSync(planted);
    const hook = path.join(planted, 'post-commit');
    fs.writeFileSync(hook, '#!/bin/sh\ntouch hook-ran\n');
    fs.chmodSync(hook, 0o755);

    expect(() => commitSnapshot(dir, 'test', process.env)).toThrow(/no-hooks exists/);
    expect(fs.existsSync(path.join(dir, 'hook-ran'))).toBe(false);
  });

  it('checks the real commit, not a replacement planted for it', () => {
    const { dir, git } = repo();
    git(['commit', '-q', '--no-gpg-sign', '-m', 'someone else'], {
      ...process.env,
      ...OTHER_ENV,
    });
    const tree = git(['rev-parse', 'HEAD^{tree}']).trim();
    const decoy = git(['commit-tree', tree, '-m', 'decoy'], snapshotCommitEnv(process.env)).trim();
    git(['replace', 'HEAD', decoy]);

    expect(commitIdentities(git(['cat-file', 'commit', 'HEAD'])).author).toEqual(PUBLIC);
    expect(() => verifySnapshotIdentity(dir)).toThrow(/author is not relaywright/);
  });

  it('refuses to start when an identity variable names someone else', () => {
    const target = path.join(tempDir(), 'snapshot');
    const result = spawnSync(process.execPath, [SCRIPT, target], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_EMAIL: OTHER_EMAIL },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GIT_AUTHOR_EMAIL would put another identity on the public commit');
    expect(fs.existsSync(target)).toBe(false);
  });
});
