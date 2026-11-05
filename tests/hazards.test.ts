import { describe, expect, it } from 'vitest';
import { cronPosition, inPatch, type Hazard } from '../src/logic/hazards';
import { NO_INPUT, spawnKart, stepKart, surfaceAt, type KartInput } from '../src/logic/kart';
import {
  createRace,
  stepRace,
  type KartRuntime,
  type Race,
  type RaceEvent,
} from '../src/logic/race';
import { buildTrack, wrapS } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';

const track = buildTrack(HALL);
const STEP = 1 / 120;
const hazards = HALL.hazards ?? [];
const ofKind = (kind: Hazard['kind']) => hazards.filter((h) => h.kind === kind);

function racing(): Race {
  const r = createRace({ laps: 3, seed: 1, driverColor: 0, bots: 0 }, track);
  while (r.phase === 'countdown') stepRace(r, [NO_INPUT], 1 / 60);
  return r;
}

function player(r: Race): KartRuntime {
  const k = r.karts[0];
  if (!k) throw new Error('kart');
  return k;
}

function place(k: KartRuntime, s: number, lateral: number, speed = 0) {
  k.kart = { ...spawnKart(track, s, lateral), speed };
  k.proj = { s, lateral };
}

function run(r: Race, seconds: number, input: KartInput = NO_INPUT): RaceEvent[] {
  const out: RaceEvent[] = [];
  for (let i = 0; i < Math.round(seconds / STEP); i++) out.push(...stepRace(r, [input], STEP));
  return out;
}

describe('the hall layout', () => {
  const rows = HALL.gateRowFractions.map((f) => f * track.length);
  const clearOfGates = (s: number, len = 0) =>
    rows.every((g) => wrapS(g - s, track.length) > len + 10 && wrapS(s - g, track.length) > 10);
  const outsidePit = (s: number, len = 0) => s + len < HALL.pit.startS || s > HALL.pit.endS;

  it('has 3 item-box rows, clear of the gate rows and the pit', () => {
    const boxRows = HALL.itemBoxRows ?? [];
    expect(boxRows).toHaveLength(3);
    for (const s of boxRows) {
      expect(clearOfGates(s)).toBe(true);
      expect(outsidePit(s)).toBe(true);
    }
  });

  it('has 2 cable patches, 2 ice zones and 2 cron lanes, clear of the gate rows and the pit', () => {
    expect(ofKind('cable')).toHaveLength(2);
    expect(ofKind('ice')).toHaveLength(2);
    expect(ofKind('cron')).toHaveLength(2);
    for (const h of hazards) {
      expect(clearOfGates(h.s, h.length)).toBe(true);
      expect(outsidePit(h.s, h.length)).toBe(true);
    }
  });
});

describe('cron jobs', () => {
  const cron = ofKind('cron')[0] as Hazard;

  it('rolls on a period', () => {
    for (const t of [0, 0.7, 2.3, 5.1]) {
      const a = cronPosition(cron, t, track);
      const b = cronPosition(cron, t + TUNING.cronPeriod, track);
      expect(b.lateral).toBeCloseTo(a.lateral, 9);
      expect(b.s).toBe(a.s);
    }
  });

  it('crosses the full road width', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < TUNING.cronPeriod; t += 0.01) {
      const p = cronPosition(cron, t, track);
      lo = Math.min(lo, p.lateral);
      hi = Math.max(hi, p.lateral);
    }
    expect(lo).toBeLessThanOrEqual(-HALL.halfWidth * 0.95);
    expect(hi).toBeGreaterThanOrEqual(HALL.halfWidth * 0.95);
  });

  it('spins a kart it rolls into, once per contact', () => {
    const r = racing();
    const p = player(r);
    // Find a time when the barrel is at the centerline, and wait there.
    const at = cronPosition(cron, r.time + 0.5, track);
    place(p, at.s, at.lateral);
    p.kart = { ...p.kart, holdTime: 5 };
    const ev = run(r, 1).filter((e) => e.type === 'hit');
    expect(ev).toEqual([{ type: 'hit', kartId: 0, kind: 'cron', outcome: 'spun', byId: null }]);
  });
});

describe('cable spaghetti', () => {
  it('spins a kart that drives in, once per entry', () => {
    const r = racing();
    const p = player(r);
    const cable = ofKind('cable')[0] as Hazard;
    place(p, cable.s - 3, cable.lateral, 12);
    const ev = run(r, 1.5, { ...NO_INPUT, throttle: 1 }).filter((e) => e.type === 'hit');
    expect(ev).toEqual([{ type: 'hit', kartId: 0, kind: 'cable', outcome: 'spun', byId: null }]);
  });

  it('lies only inside its patch', () => {
    const cable = ofKind('cable')[0] as Hazard;
    const mid = cable.s + cable.length / 2;
    expect(inPatch(cable, { s: mid, lateral: cable.lateral }, track.length)).toBe(true);
    expect(inPatch(cable, { s: mid, lateral: cable.lateral + cable.width }, track.length)).toBe(
      false,
    );
    expect(inPatch(cable, { s: cable.s - 1, lateral: cable.lateral }, track.length)).toBe(false);
  });
});

describe('change-freeze ice', () => {
  const ice = ofKind('ice')[0] as Hazard;

  it('is an ice surface on the road inside the zone', () => {
    expect(surfaceAt({ s: ice.s + ice.length / 2, lateral: 0 }, track)).toBe('ice');
    expect(surfaceAt({ s: ice.s - 2, lateral: 0 }, track)).toBe('road');
  });

  it('lowers grip: the same steer turns the kart less, and it slides wide', () => {
    const start = { ...spawnKart(track, 300, 0), speed: 18 };
    const input: KartInput = { ...NO_INPUT, throttle: 1, steer: 1 };
    let road = start;
    let onIce = start;
    for (let i = 0; i < 60; i++) {
      road = stepKart(road, input, STEP, 'road');
      onIce = stepKart(onIce, input, STEP, 'ice');
    }
    const turn = (k: typeof start) => Math.abs(k.heading - start.heading);
    expect(turn(onIce)).toBeLessThan(turn(road) * TUNING.iceGrip + 1e-9);
    expect(turn(onIce)).toBeGreaterThan(0);
    // Wide: the ice kart ends further right (outside of a left turn) of the road kart.
    const right = { x: -Math.cos(start.heading), z: Math.sin(start.heading) };
    const side = (k: typeof start) => k.pos.x * right.x + k.pos.z * right.z;
    expect(side(onIce)).toBeGreaterThan(side(road));
  });
});
