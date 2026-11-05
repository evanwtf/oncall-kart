import type { Rng } from '../../logic/rng';
import type { TicketType } from '../../logic/runbooks';
import { SHOOTER_TUNING } from './tuning';

/**
 * When servers break in one shift: SHOOTER_TUNING.breaks times, ascending.
 * The first is at firstBreak; each gap is at least minBreakGap; none falls
 * in the last quietEnd seconds. The slack beyond the minimum gaps is shared
 * out at random, with one share left over after the last break.
 */
export function breakTimes(rng: Rng): number[] {
  const t = SHOOTER_TUNING;
  const last = t.shiftSeconds - t.quietEnd;
  const gaps = t.breaks - 1;
  const slack = Math.max(0, last - t.firstBreak - gaps * t.minBreakGap);
  // gaps + 1 weights: one per gap, and the tail after the last break.
  const weights = Array.from({ length: gaps + 1 }, () => 0.2 + rng());
  const total = weights.reduce((a, b) => a + b, 0);
  const times: number[] = [t.firstBreak];
  let at: number = t.firstBreak;
  for (let i = 0; i < gaps; i++) {
    at += t.minBreakGap + (slack * (weights[i] ?? 0)) / total;
    times.push(Math.min(at, last));
  }
  return times;
}

/** SLA time (s) for a ticket in the shooter: shorter than in the kart race. */
export function shooterSla(type: TicketType): number {
  return SHOOTER_TUNING.slaBase + SHOOTER_TUNING.slaPerStep * type.steps.length;
}
