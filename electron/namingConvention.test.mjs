import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  matchesConvention,
  normalizeConvention,
  DEFAULT_CONVENTION,
  recomputeConventionMatches,
} = require('./namingConvention.js');

describe('namingConvention', () => {
  it('is disabled by default', () => {
    expect(DEFAULT_CONVENTION.enabled).toBe(false);
    expect(matchesConvention('V2 - Orders', DEFAULT_CONVENTION)).toBe(false);
  });
  it('matches a case-insensitive prefix after trimming the name', () => {
    const c = { enabled: true, prefix: 'v2', label: 'Rebuilt' };
    expect(matchesConvention('  V2 - Orders', c)).toBe(true);
    expect(matchesConvention('Orders v2', c)).toBe(false);
  });
  it('empty prefix matches nothing', () => {
    expect(matchesConvention('Anything', { enabled: true, prefix: '   ', label: 'x' })).toBe(false);
  });
  it('normalizes junk input to defaults', () => {
    expect(normalizeConvention(null)).toEqual(DEFAULT_CONVENTION);
    expect(normalizeConvention({ enabled: 'yes', prefix: 5 })).toEqual({
      enabled: true,
      prefix: '',
      label: 'Matches convention',
    });
  });
});

describe('recomputeConventionMatches', () => {
  it('recomputes matches_convention for every base from the given convention, batching the writes', () => {
    const calls = [];
    const fakeDatabase = {
      getAllBasesLite: () => [
        { id: 'app1', name: 'V2 - Orders' },
        { id: 'app2', name: 'Legacy Orders' },
        { id: 'app3', name: 'v2-inventory' },
      ],
      beginBatch: () => calls.push('begin'),
      endBatch: () => calls.push('end'),
      setBaseMatchesConvention: (id, matches) => calls.push(['set', id, matches]),
    };

    recomputeConventionMatches(fakeDatabase, { enabled: true, prefix: 'v2', label: 'Rebuilt' });

    expect(calls).toEqual([
      'begin',
      ['set', 'app1', true],
      ['set', 'app2', false],
      ['set', 'app3', true],
      'end',
    ]);
  });

  it('marks every base as not matching when the convention is disabled', () => {
    const calls = [];
    const fakeDatabase = {
      getAllBasesLite: () => [{ id: 'app1', name: 'V2 - Orders' }],
      beginBatch: () => calls.push('begin'),
      endBatch: () => calls.push('end'),
      setBaseMatchesConvention: (id, matches) => calls.push(['set', id, matches]),
    };

    recomputeConventionMatches(fakeDatabase, { enabled: false, prefix: 'v2', label: 'Rebuilt' });

    expect(calls).toEqual(['begin', ['set', 'app1', false], 'end']);
  });
});
