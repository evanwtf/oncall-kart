import { dot, type Vec2 } from './vec';

// s is metres along the centerline, in [0, length). lateral > 0 is left of the
// travel direction. The left of a tangent (tx, tz) is (tz, -tx).

/** The pit lane: a lane beside the road, behind a divider wall. */
export interface PitDef {
  /** s where the pit entry opening starts. */
  startS: number;
  /** s where the pit exit opening ends. */
  endS: number;
  /** 1: the pit lies left of the road. -1: right. */
  side: 1 | -1;
  /** Lateral distance (absolute) from the centerline to the pit lane center. */
  centerOffset: number;
  halfWidth: number;
  /** Length of the opening in the divider at the entry. */
  entryLen: number;
  /** Length of the opening in the divider at the exit. */
  exitLen: number;
}

export interface TrackDef {
  name: string;
  controlPoints: readonly Vec2[];
  halfWidth: number;
  /** Gate rows, as fractions of the lap length. */
  gateRowFractions: readonly number[];
  sectorCount: number;
  pit: PitDef;
  /** s of the starting grid. */
  gridS: number;
}

export interface Projection {
  s: number;
  lateral: number;
}

export interface Track {
  def: TrackDef;
  length: number;
  pointAt(s: number): Vec2;
  tangentAt(s: number): Vec2;
  /** Nearest centerline point. With hintS, search only near the hint. */
  project(p: Vec2, hintS?: number): Projection;
}

export function wrapS(s: number, length: number): number {
  const r = s % length;
  return r < 0 ? r + length : r === length ? 0 : r;
}

/** Signed distance from prevS to curS, the shortest way round the loop. */
export function forwardDelta(prevS: number, curS: number, length: number): number {
  let d = wrapS(curS - prevS, length);
  if (d > length / 2) d -= length;
  return d;
}

/** True when a forward move from prevS to curS passes markS. The mark is in (prevS, curS]. */
export function crossedForward(
  markS: number,
  prevS: number,
  curS: number,
  length: number,
): boolean {
  const delta = forwardDelta(prevS, curS, length);
  if (delta <= 0) return false;
  const d = wrapS(markS - prevS, length);
  return d > 0 && d <= delta;
}

/** True when a backward move from prevS to curS passes markS. The mark is in (curS, prevS]. */
export function crossedBackward(
  markS: number,
  prevS: number,
  curS: number,
  length: number,
): boolean {
  const delta = forwardDelta(prevS, curS, length);
  if (delta >= 0) return false;
  const d = wrapS(prevS - markS, length);
  return d < -delta;
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

/** Build a closed Catmull-Rom centerline with an arc-length table. */
export function buildTrack(def: TrackDef, samples = 2048): Track {
  const cps = def.controlPoints;
  const n = cps.length;
  if (n < 4) throw new Error('buildTrack: need at least 4 control points');
  const cp = (i: number) => cps[((i % n) + n) % n] as Vec2;

  const pts: Vec2[] = [];
  for (let i = 0; i < samples; i++) {
    const u = (i / samples) * n;
    const seg = Math.floor(u);
    pts.push(catmullRom(cp(seg - 1), cp(seg), cp(seg + 1), cp(seg + 2), u - seg));
  }
  const cum: number[] = [0];
  for (let i = 1; i <= samples; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i % samples] as Vec2;
    cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const length = cum[samples] as number;

  /** Index i with cum[i] <= s < cum[i + 1]. */
  const segmentAt = (s: number): number => {
    let lo = 0;
    let hi = samples - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((cum[mid] as number) <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const pointAt = (sIn: number): Vec2 => {
    const s = wrapS(sIn, length);
    const i = segmentAt(s);
    const a = pts[i] as Vec2;
    const b = pts[(i + 1) % samples] as Vec2;
    const c0 = cum[i] as number;
    const segLen = (cum[i + 1] as number) - c0;
    const t = segLen > 0 ? (s - c0) / segLen : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };

  const tangentAt = (s: number): Vec2 => {
    const a = pointAt(s - 0.5);
    const b = pointAt(s + 0.5);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  };

  const projectOnSegment = (p: Vec2, i: number) => {
    const a = pts[i] as Vec2;
    const b = pts[(i + 1) % samples] as Vec2;
    const ab = { x: b.x - a.x, z: b.z - a.z };
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot({ x: p.x - a.x, z: p.z - a.z }, ab) / l2)) : 0;
    const q = { x: a.x + ab.x * t, z: a.z + ab.z * t };
    const d2 = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
    return { d2, s: (cum[i] as number) + t * ((cum[i + 1] as number) - (cum[i] as number)) };
  };

  const project = (p: Vec2, hintS?: number): Projection => {
    let best = { d2: Infinity, s: 0 };
    const scan = (i: number) => {
      const r = projectOnSegment(p, ((i % samples) + samples) % samples);
      if (r.d2 < best.d2) best = r;
    };
    if (hintS === undefined) {
      for (let i = 0; i < samples; i++) scan(i);
    } else {
      // Search 40 m either side of the hint: enough for a 0.1 s step at any speed.
      const center = segmentAt(wrapS(hintS, length));
      const span = Math.ceil((40 / length) * samples);
      for (let k = -span; k <= span; k++) scan(center + k);
    }
    const s = wrapS(best.s, length);
    const c = pointAt(s);
    const t = tangentAt(s);
    const lateral = (p.x - c.x) * t.z - (p.z - c.z) * t.x;
    return { s, lateral };
  };

  return { def, length, pointAt, tangentAt, project };
}
