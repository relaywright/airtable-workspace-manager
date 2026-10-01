import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashToken, scanText, loadDenySet, scanFiles } from './check-clean.mjs';

describe('check-clean', () => {
  const deny = new Set([hashToken('forbidden'), hashToken('appRealBase123456')]);
  it('hashes case-insensitively to 16 hex chars', () => {
    expect(hashToken('Forbidden')).toBe(hashToken('forbidden'));
    expect(hashToken('x')).toMatch(/^[0-9a-f]{16}$/);
  });
  it('finds a denylisted word and reports its line', () => {
    expect(scanText('ok\nthe FORBIDDEN prefix', deny)).toEqual([{ token: 'FORBIDDEN', line: 2 }]);
  });
  it('finds a denylisted Airtable id', () => {
    expect(scanText('base: appRealBase123456', deny).map((f) => f.line)).toEqual([1]);
  });
  it('finds a denylisted word inside camelCase and snake_case identifiers', () => {
    expect(scanText('const isForbiddenBase = 1;\nrow.is_forbidden', deny).map((f) => f.line)).toEqual([1, 2]);
  });
  it('ignores fake demo ids and ordinary words', () => {
    expect(scanText('appDemoOrders0001 forbiddenish', deny)).toEqual([]);
  });
  it('finds a denylisted word inside a kebab-case identifier', () => {
    expect(scanText('<div class="badge-forbidden">', deny).map((f) => f.line)).toEqual([1]);
  });
  it('merges a local denylist file when present and skips it when missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-clean-test-'));
    const presentPath = path.join(dir, 'present.sha256.txt');
    const missingPath = path.join(dir, 'missing.sha256.txt');
    fs.writeFileSync(presentPath, `${hashToken('secretword')}\n`);

    const missingOnly = loadDenySet([missingPath]);
    expect(missingOnly.size).toBe(0);

    const merged = loadDenySet([presentPath, missingPath]);
    expect(merged.has(hashToken('secretword'))).toBe(true);
    expect(merged.size).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('ignores comment lines starting with # when loading a denylist file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-clean-test-'));
    const withComments = path.join(dir, 'commented.sha256.txt');
    fs.writeFileSync(withComments, `# header comment\n${hashToken('secretword')}\n`);

    const denySet = loadDenySet([withComments]);
    expect(denySet.has(hashToken('secretword'))).toBe(true);
    expect(denySet.has('# header comment')).toBe(false);
    expect(denySet.size).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('finds a denylisted whole word containing an ampersand', () => {
    const ampDeny = new Set([...deny, hashToken('at&t')]);
    expect(scanText('Ship via AT&T today', ampDeny).map((f) => f.line)).toEqual([1]);
  });

  describe('scanFiles', () => {
    it('counts an ENOENT read (deleted in working tree) as skipped, with no finding', () => {
      const readFile = () => {
        const err = new Error('no such file');
        err.code = 'ENOENT';
        throw err;
      };
      const result = scanFiles(['deleted.txt'], deny, readFile);
      expect(result).toEqual({ findings: [], skipped: ['deleted.txt'], unreadable: [] });
    });

    it('records any other read error (e.g. EACCES) as unreadable with its code', () => {
      const readFile = () => {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      };
      const result = scanFiles(['locked.txt'], deny, readFile);
      expect(result).toEqual({
        findings: [],
        skipped: [],
        unreadable: [{ file: 'locked.txt', code: 'EACCES' }],
      });
    });

    it('still finds a denylisted word in a normally-readable file', () => {
      const readFile = (file) => (file === 'notes.txt' ? 'the FORBIDDEN prefix' : '');
      const result = scanFiles(['notes.txt'], deny, readFile);
      expect(result.findings).toEqual([{ file: 'notes.txt', line: 1, hash: hashToken('forbidden') }]);
      expect(result.skipped).toEqual([]);
      expect(result.unreadable).toEqual([]);
    });
  });
});
