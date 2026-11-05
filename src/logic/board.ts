import { OPS, type Op } from './ops';
import { pick, shuffle, type Rng } from './rng';
import type { Track } from './track';

/** One gate in a row. lateral is the gate center; the gate spans lateral ± halfWidth. */
export interface GateSlot {
  lateral: number;
  halfWidth: number;
  op: Op;
}

export interface GateRow {
  s: number;
  slots: GateSlot[];
}

/** The change board: every gate row on the track. */
export type Board = GateRow[];

/**
 * Gate layouts as fractions of the road half-width: [center, half-width].
 * The gaps between gates are the open lanes.
 */
const LAYOUTS: Readonly<Record<2 | 3, ReadonlyArray<readonly [number, number]>>> = {
  2: [
    [-0.42, 0.26],
    [0.42, 0.26],
  ],
  3: [
    [-0.7, 0.2],
    [0, 0.2],
    [0.7, 0.2],
  ],
};

export function createBoard(rng: Rng, track: Track): Board {
  const hw = track.def.halfWidth;
  const fractions = track.def.gateRowFractions;
  const counts = fractions.map(() => (rng() < 0.5 ? 2 : 3) as 2 | 3);
  // Every op must fit on the board at least once.
  while (counts.reduce((a, b) => a + b, 0) < OPS.length) {
    const i = counts.indexOf(2);
    if (i < 0) throw new Error('createBoard: too few gate rows for every op');
    counts[i] = 3;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const pool: Op[] = [...OPS];
  while (pool.length < total) pool.push(pick(rng, OPS));
  const ops = shuffle(rng, pool);

  let next = 0;
  return fractions.map((f, i) => ({
    s: f * track.length,
    slots: LAYOUTS[counts[i] as 2 | 3].map(([c, w]) => ({
      lateral: c * hw,
      halfWidth: w * hw,
      op: ops[next++] as Op,
    })),
  }));
}

/** The gate under a lateral offset, or null in an open lane. */
export function slotAt(row: GateRow, lateral: number): GateSlot | null {
  return row.slots.find((s) => Math.abs(lateral - s.lateral) <= s.halfWidth) ?? null;
}

/**
 * Reshuffle the row the player just passed: swap each of its ops with a
 * random slot in another row. The next row stays as it is, so no row changes
 * while the player approaches it. Returns a new board.
 */
export function reshuffleAfterPass(board: Board, passedRow: number, rng: Rng): Board {
  const out: Board = board.map((r) => ({ s: r.s, slots: r.slots.map((s) => ({ ...s })) }));
  const n = out.length;
  const keep = (passedRow + 1) % n;
  const others: Array<[number, number]> = [];
  out.forEach((r, ri) => {
    if (ri === passedRow || ri === keep) return;
    r.slots.forEach((_, si) => others.push([ri, si]));
  });
  const row = out[passedRow];
  if (!row || others.length === 0) return out;
  for (const slot of row.slots) {
    const [ri, si] = pick(rng, others);
    const other = out[ri]?.slots[si];
    if (!other) continue;
    [slot.op, other.op] = [other.op, slot.op];
  }
  return out;
}
