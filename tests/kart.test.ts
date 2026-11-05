import { describe, expect, it } from 'vitest';
import {
  constrainToTrack,
  driftStage,
  NO_INPUT,
  spawnKart,
  stepKart,
  surfaceAt,
  type KartInput,
  type KartState,
  type Surface,
} from '../src/logic/kart';
import { buildTrack } from '../src/logic/track';
import { HALL } from '../src/logic/tracks/hall';
import { TUNING } from '../src/logic/tuning';

const DT = 1 / 120;
const track = buildTrack(HALL);
const GAS: KartInput = { ...NO_INPUT, throttle: 1 };

function run(k: KartState, input: KartInput, seconds: number, surface: Surface = 'road') {
  let st = k;
  let max = -Infinity;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    st = stepKart(st, input, DT, surface);
    max = Math.max(max, st.speed);
  }
  return { st, max };
}

const fresh = () => spawnKart(track, 300, 0);

describe('kart speed', () => {
  it('settles at topSpeed on road and never exceeds it', () => {
    const { st, max } = run(fresh(), GAS, 10);
    expect(st.speed).toBeGreaterThan(TUNING.topSpeed * 0.99);
    expect(max).toBeLessThanOrEqual(TUNING.topSpeed * 1.0001);
  });

  it('settles at offroadTopSpeed off the road', () => {
    const { st } = run(fresh(), GAS, 10, 'offroad');
    expect(st.speed).toBeCloseTo(TUNING.offroadTopSpeed, 1);
  });

  it('slows to offroadTopSpeed after leaving the road at speed', () => {
    const fast = run(fresh(), GAS, 10).st;
    const { st } = run(fast, GAS, 3, 'offroad');
    expect(st.speed).toBeCloseTo(TUNING.offroadTopSpeed, 1);
  });

  it('never exceeds the pit speed limit from rest', () => {
    const { max } = run(fresh(), GAS, 10, 'pit');
    expect(max).toBeLessThanOrEqual(TUNING.pitSpeedLimit * 1.0001);
  });

  it('brakes to a stop, then reverses to at most reverseSpeed', () => {
    const fast = run(fresh(), GAS, 5).st;
    let st = fast;
    let stopped = false;
    for (let i = 0; i < 120 * 10; i++) {
      st = stepKart(st, { ...NO_INPUT, brake: 1 }, DT, 'road');
      if (Math.abs(st.speed) < 0.05) stopped = true;
    }
    expect(stopped).toBe(true);
    expect(st.speed).toBeLessThan(0);
    expect(st.speed).toBeGreaterThanOrEqual(-TUNING.reverseSpeed * 1.0001);
    expect(st.speed).toBeCloseTo(-TUNING.reverseSpeed, 1);
  });

  it('coasts down without throttle', () => {
    const fast = run(fresh(), GAS, 5).st;
    expect(run(fast, NO_INPUT, 2).st.speed).toBeLessThan(fast.speed);
  });

  it('ignores input and loses speed while spinning', () => {
    const fast = run(fresh(), GAS, 5).st;
    const spun = { ...fast, spinTime: 0.5 };
    const after = stepKart(spun, { ...GAS, steer: 1 }, DT, 'road');
    expect(after.speed).toBeLessThan(fast.speed);
    expect(after.heading).toBe(fast.heading);
    expect(after.spinTime).toBeCloseTo(0.5 - DT);
  });

  it('stays put while held', () => {
    const k = { ...fresh(), holdTime: 1 };
    const { st } = run(k, GAS, 0.5);
    expect(st.pos).toEqual(k.pos);
    expect(st.speed).toBe(0);
    expect(st.holdTime).toBeCloseTo(0.5);
  });

  it('caps speed while slowed', () => {
    const { max } = run({ ...fresh(), slowTime: 20 }, GAS, 10);
    expect(max).toBeLessThanOrEqual(TUNING.slowFactor * TUNING.topSpeed * 1.0001);
  });

  it('goes faster than topSpeed while boosted', () => {
    const fast = run(fresh(), GAS, 10).st;
    const { max } = run({ ...fast, boostTime: 1 }, GAS, 1);
    expect(max).toBeGreaterThan(TUNING.topSpeed * 1.05);
  });

  it('steers left on +steer', () => {
    const fast = run(fresh(), GAS, 3).st;
    const after = run(fast, { ...GAS, steer: 1 }, 0.3).st;
    expect(after.heading).toBeGreaterThan(fast.heading);
  });
});

describe('drift', () => {
  const atSpeed = () => run(fresh(), GAS, 5).st;
  const drift = (k: KartState, seconds: number) => {
    const held = run(k, { ...GAS, steer: 1, drift: true }, seconds).st;
    return stepKart(held, { ...GAS, steer: 1, drift: false }, DT, 'road');
  };

  it('maps drift time to stages', () => {
    expect(driftStage(0)).toBe(0);
    expect(driftStage(TUNING.driftStages[1])).toBe(1);
    expect(driftStage(TUNING.driftStages[2])).toBe(2);
    expect(driftStage(TUNING.driftStages[3] + 5)).toBe(3);
  });

  it('gives the stage 1 boost after a stage 1 drift', () => {
    const out = drift(atSpeed(), TUNING.driftStages[1] + 0.05);
    expect(out.boostTime).toBeCloseTo(TUNING.driftBoost[1], 5);
    expect(out.driftDir).toBe(0);
  });

  it('gives the longest boost at stage 3', () => {
    const out = drift(atSpeed(), TUNING.driftStages[3] + 0.05);
    expect(out.boostTime).toBeCloseTo(TUNING.driftBoost[3], 5);
    expect(TUNING.driftBoost[3]).toBeGreaterThan(TUNING.driftBoost[2]);
    expect(TUNING.driftBoost[2]).toBeGreaterThan(TUNING.driftBoost[1]);
  });

  it('gives no boost when released before stage 1', () => {
    const out = drift(atSpeed(), TUNING.driftStages[1] * 0.5);
    expect(out.boostTime).toBe(0);
  });

  it('starts only above driftMinSpeed', () => {
    const slow = { ...fresh(), speed: TUNING.driftMinSpeed * 0.5 };
    const out = stepKart(slow, { ...NO_INPUT, steer: 1, drift: true }, DT, 'road');
    expect(out.driftDir).toBe(0);
    const fast = atSpeed();
    expect(stepKart(fast, { ...GAS, steer: 1, drift: true }, DT, 'road').driftDir).toBe(1);
  });
});

describe('walls and surfaces', () => {
  const s = 300;
  const at = (lateral: number, speed = 20): KartState => ({
    ...spawnKart(track, s, lateral),
    speed,
  });
  const wall = HALL.halfWidth + TUNING.offroadWidth;

  it('pushes a kart 2 m past the outer edge back inside and slows it', () => {
    const k = at(-(wall + 2));
    const out = constrainToTrack(k, track.project(k.pos, s), track);
    expect(Math.abs(track.project(out.pos, s).lateral)).toBeLessThanOrEqual(wall + 1e-3);
    expect(out.speed).toBeLessThanOrEqual(k.speed * 0.7);
  });

  it('leaves a kart inside the road alone', () => {
    const k = at(3);
    expect(constrainToTrack(k, track.project(k.pos, s), track)).toEqual(k);
  });

  const pit = HALL.pit;
  const pitMid = (pit.startS + pit.endS) / 2;
  const pitLat = pit.side * pit.centerOffset;

  it('lets a kart in the pit lane stay there', () => {
    const k = { ...spawnKart(track, pitMid, pitLat), speed: 10 };
    const p = track.project(k.pos, pitMid);
    expect(surfaceAt(p, track)).toBe('pit');
    expect(constrainToTrack(k, p, track)).toEqual(k);
  });

  it('keeps the pit outer wall at the pit edge', () => {
    const k = {
      ...spawnKart(track, pitMid, pit.side * (pit.centerOffset + pit.halfWidth + 1)),
      speed: 10,
    };
    const out = constrainToTrack(k, track.project(k.pos, pitMid), track);
    const lat = track.project(out.pos, pitMid).lateral * pit.side;
    expect(lat).toBeLessThanOrEqual(pit.centerOffset + pit.halfWidth + 1e-6);
  });

  it('treats the divider as a wall between the openings', () => {
    const divider = pit.side * (HALL.halfWidth + 0.3);
    const k = { ...spawnKart(track, pitMid, divider), speed: 10 };
    const out = constrainToTrack(k, track.project(k.pos, pitMid), track);
    expect(track.project(out.pos, pitMid).lateral * pit.side).toBeLessThanOrEqual(HALL.halfWidth);
  });

  it('opens the divider at the entry and the exit', () => {
    for (const sAt of [pit.startS + pit.entryLen / 2, pit.endS - pit.exitLen / 2]) {
      const k = { ...spawnKart(track, sAt, pit.side * (HALL.halfWidth + 0.5)), speed: 10 };
      expect(constrainToTrack(k, track.project(k.pos, sAt), track)).toEqual(k);
    }
  });

  it('names the surface under a kart', () => {
    expect(surfaceAt({ s, lateral: 0 }, track)).toBe('road');
    expect(surfaceAt({ s, lateral: HALL.halfWidth + 1 }, track)).toBe('offroad');
    expect(surfaceAt({ s, lateral: -(HALL.halfWidth + 1) }, track)).toBe('offroad');
    expect(surfaceAt({ s: pitMid, lateral: pitLat }, track)).toBe('pit');
    expect(surfaceAt({ s: pit.endS + 30, lateral: pitLat }, track)).toBe('offroad');
  });

  it('spawns facing the travel direction at rest', () => {
    const k = spawnKart(track, 50, 0);
    const t = track.tangentAt(50);
    expect(Math.sin(k.heading)).toBeCloseTo(t.x, 5);
    expect(Math.cos(k.heading)).toBeCloseTo(t.z, 5);
    expect(k.speed).toBe(0);
  });
});

describe('wall scrapes', () => {
  it('costs little speed for a shallow scrape', () => {
    const wall = HALL.halfWidth + TUNING.offroadWidth;
    const k = { ...spawnKart(track, 300, -(wall + 0.05)), speed: 20 };
    const out = constrainToTrack(k, track.project(k.pos, 300), track);
    expect(out.speed).toBeGreaterThan(19);
  });
});

describe('scraping along a wall', () => {
  it('keeps most of its speed while steering hard into the divider', () => {
    const pit = HALL.pit;
    const sMid = (pit.startS + pit.endS) / 2;
    let k = { ...spawnKart(track, sMid - 20, pit.side * (HALL.halfWidth - 0.3)), speed: 18 };
    let hint = sMid - 20;
    for (let i = 0; i < 240; i++) {
      k = stepKart(k, { ...GAS, steer: pit.side }, DT, 'road');
      const p = track.project(k.pos, hint);
      k = constrainToTrack(k, p, track);
      hint = track.project(k.pos, p.s).s;
    }
    expect(k.speed).toBeGreaterThan(12);
  });
});
