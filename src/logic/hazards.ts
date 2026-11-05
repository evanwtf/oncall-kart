import type { Projection, Track } from './track';
import { forwardDelta, wrapS } from './track';
import { TUNING } from './tuning';

/**
 * A hazard on the track. s and length are along the centerline (m): the
 * hazard spans s..s+length. lateral is its center; width is its full width.
 * - cable: a slick patch; a kart that drives in spins.
 * - ice: a low-grip surface (see surfaceAt).
 * - cron: a barrel at s, length across, that rolls across lateral ± width/2
 *   on a period of TUNING.cronPeriod; phase (0..1) offsets its timer.
 */
export interface Hazard {
  kind: 'cable' | 'ice' | 'cron';
  s: number;
  lateral: number;
  length: number;
  width: number;
  phase?: number;
}

/** True when p lies inside the hazard's patch. */
export function inPatch(h: Hazard, p: Projection, trackLength: number): boolean {
  const along = wrapS(p.s - h.s, trackLength);
  return along <= h.length && Math.abs(p.lateral - h.lateral) <= h.width / 2;
}

/** The barrel of a cron hazard at a race time: it rolls edge to edge and back. */
export function cronPosition(
  h: Hazard,
  time: number,
  track: Track,
): { s: number; lateral: number } {
  const u = time / TUNING.cronPeriod + (h.phase ?? 0);
  const f = u - Math.floor(u);
  const tri = 1 - Math.abs(2 * f - 1); // 0 -> 1 -> 0
  return { s: wrapS(h.s, track.length), lateral: h.lateral - h.width / 2 + h.width * tri };
}

/** True when a kart at p touches the hazard: inside a cable patch, or on a cron barrel. */
export function touches(h: Hazard, p: Projection, time: number, track: Track): boolean {
  if (h.kind === 'cable') return inPatch(h, p, track.length);
  if (h.kind === 'cron') {
    const c = cronPosition(h, time, track);
    const ds = forwardDelta(c.s, p.s, track.length);
    return Math.hypot(ds, p.lateral - c.lateral) < h.length / 2 + TUNING.kartRadius;
  }
  return false;
}
