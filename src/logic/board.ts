import { OPS, type Op } from './ops';
import { pick, shuffle, type Rng } from './rng';
import type { Track } from './track';
import { TUNING } from './tuning';

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
  const counts = fractions.map(() => (rng() < TUNING.twoGateRowShare ? 2 : 3) as 2 | 3);
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

/** Rows ahead of the player that a reshuffle never touches. */
const PROTECTED_AHEAD = 2;

/**
 * Reshuffle the row the player just passed ("the change board moved"): swap
 * each of its ops with a random slot in a row behind the player. The next
 * two rows stay as they are, so no row changes while the player approaches
 * it. Returns a new board and the rows whose ops changed.
 */
export function reshuffleAfterPass(
  board: Board,
  passedRow: number,
  rng: Rng,
): { board: Board; rows: number[] } {
  const out: Board = board.map((r) => ({ s: r.s, slots: r.slots.map((s) => ({ ...s })) }));
  const n = out.length;
  const others: Array<[number, number]> = [];
  for (let k = PROTECTED_AHEAD + 1; k < n; k++) {
    const ri = (passedRow + k) % n;
    out[ri]?.slots.forEach((_, si) => others.push([ri, si]));
  }
  const row = out[passedRow];
  if (!row || others.length === 0) return { board: out, rows: [] };
  for (const slot of row.slots) {
    const [ri, si] = pick(rng, others);
    const other = out[ri]?.slots[si];
    if (!other) continue;
    [slot.op, other.op] = [other.op, slot.op];
  }
  const rows = out
    .map((r, i) => (r.slots.some((s, j) => s.op !== board[i]?.slots[j]?.op) ? i : -1))
    .filter((i) => i >= 0);
  return { board: out, rows };
}
