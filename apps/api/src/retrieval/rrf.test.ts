import { describe, expect, it } from 'vitest';
import { fuseRrf, RRF_K } from './rrf.js';

describe('fuseRrf', () => {
  it('keeps a single list order with scores 1 / (k + rank)', () => {
    const out = fuseRrf([['c', 'a', 'b']]);
    expect(out.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    out.forEach((r, i) => expect(r.score).toBeCloseTo(1 / (RRF_K + i + 1), 12));
  });

  it('ranks an id in both lists above ids at the same ranks in one list', () => {
    const out = fuseRrf([
      ['a', 'b'],
      ['c', 'b'],
    ]);
    expect(out[0]?.id).toBe('b');
    expect(out[0]?.score).toBeCloseTo(2 / (RRF_K + 2), 12);
    expect(out.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks ties by id ascending, independent of list order and repeat calls', () => {
    const a = fuseRrf([['z'], ['m']]);
    const b = fuseRrf([['m'], ['z']]);
    expect(a.map((r) => r.id)).toEqual(['m', 'z']);
    expect(b).toEqual(a);
    expect(fuseRrf([['z'], ['m']])).toEqual(a);
  });

  it('returns [] for empty input or empty lists', () => {
    expect(fuseRrf([])).toEqual([]);
    expect(fuseRrf([[], []])).toEqual([]);
  });

  it('uses a custom k', () => {
    const out = fuseRrf([['a']], 10);
    expect(out[0]?.id).toBe('a');
    expect(out[0]?.score).toBeCloseTo(1 / 11, 12);
  });
});
