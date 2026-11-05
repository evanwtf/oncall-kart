import { describe, expect, it } from 'vitest';
import { makeRng, pick, shuffle } from '../src/logic/rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
  });

  it('gives values in [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shuffle keeps the multiset and does not mutate the input', () => {
    const items = [1, 2, 2, 3, 4, 5, 5, 5];
    const copy = [...items];
    const out = shuffle(makeRng(3), items);
    expect(items).toEqual(copy);
    expect([...out].sort()).toEqual([...items].sort());
  });

  it('pick returns an item of the list', () => {
    const r = makeRng(9);
    for (let i = 0; i < 100; i++) expect(['a', 'b', 'c']).toContain(pick(r, ['a', 'b', 'c']));
  });
});
