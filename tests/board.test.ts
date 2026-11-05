import { describe, expect, it } from 'vitest';
import { createBoard, reshuffleAfterPass, slotAt, type Board } from '../src/logic/board';
import { OPS } from '../src/logic/ops';
import { makeRng } from '../src/logic/rng';
import { crossedForward } from '../src/logic/track';
import { circleTrack } from './helpers';

const track = circleTrack(110);
const ops = (b: Board) => b.flatMap((r) => r.slots.map((s) => s.op)).sort();

describe('board', () => {
  it('makes one row per fraction with 2-3 slots inside the road', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const b = createBoard(makeRng(seed), track);
      expect(b).toHaveLength(track.def.gateRowFractions.length);
      b.forEach((row, i) => {
        expect(row.s).toBeCloseTo((track.def.gateRowFractions[i] as number) * track.length);
        expect(row.slots.length).toBeGreaterThanOrEqual(2);
        expect(row.slots.length).toBeLessThanOrEqual(3);
        const sorted = [...row.slots].sort((a, b) => a.lateral - b.lateral);
        sorted.forEach((s, j) => {
          expect(Math.abs(s.lateral) + s.halfWidth).toBeLessThanOrEqual(track.def.halfWidth);
          const nxt = sorted[j + 1];
          if (nxt) expect(nxt.lateral - nxt.halfWidth).toBeGreaterThan(s.lateral + s.halfWidth);
        });
      });
      for (const op of OPS) expect(ops(b)).toContain(op);
    }
  });

  it('finds the slot under a lateral, or null in an open lane', () => {
    const row = createBoard(makeRng(1), track)[0];
    if (!row) throw new Error('no row');
    for (const s of row.slots) {
      expect(slotAt(row, s.lateral)).toBe(s);
      expect(slotAt(row, s.lateral + s.halfWidth * 0.9)).toBe(s);
    }
    const sorted = [...row.slots].sort((a, b) => a.lateral - b.lateral);
    const [a, b] = sorted;
    if (!a || !b) throw new Error('slots');
    expect(slotAt(row, (a.lateral + a.halfWidth + b.lateral - b.halfWidth) / 2)).toBeNull();
  });

  it('reshuffles the passed row, keeps the next two rows and every op', () => {
    let changed = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const rng = makeRng(seed);
      const before = createBoard(rng, track);
      const n = before.length;
      const passed = seed % n;
      const snapshot = JSON.stringify(before);
      const { board: after, rows } = reshuffleAfterPass(before, passed, rng);
      expect(JSON.stringify(before)).toBe(snapshot);
      expect(ops(after)).toEqual(ops(before));
      for (const op of OPS) expect(ops(after)).toContain(op);
      // The two rows ahead of the player never change.
      expect(after[(passed + 1) % n]).toEqual(before[(passed + 1) % n]);
      expect(after[(passed + 2) % n]).toEqual(before[(passed + 2) % n]);
      expect(rows).not.toContain((passed + 1) % n);
      expect(rows).not.toContain((passed + 2) % n);
      // Every row the result does not name is unchanged.
      for (let i = 0; i < n; i++) {
        if (!rows.includes(i)) expect(after[i], `row ${i}`).toEqual(before[i]);
      }
      const p0 = before[passed]?.slots.map((s) => s.op).join();
      const p1 = after[passed]?.slots.map((s) => s.op).join();
      if (p0 !== p1) {
        changed++;
        expect(rows).toContain(passed);
      }
    }
    expect(changed).toBeGreaterThanOrEqual(95);
  });

  it('crosses a row near s = 0 across the seam', () => {
    const L = track.length;
    expect(crossedForward(0.5, L - 1, 2, L)).toBe(true);
  });
});
