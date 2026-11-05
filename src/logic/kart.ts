import type { Projection, Track } from './track';
import { TUNING } from './tuning';
import type { Vec2 } from './vec';

/** steer: -1 is full right, +1 is full left. throttle and brake: 0 to 1. */
export interface KartInput {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
}

export const NO_INPUT: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false };

/**
 * Arcade kart state. heading is in radians; the forward vector is
 * (sin heading, cos heading) in (x, z). speed is signed: < 0 is reverse.
 */
export interface KartState {
  pos: Vec2;
  heading: number;
  speed: number;
  /** Drift direction: 1 left, -1 right, 0 no drift. */
  driftDir: -1 | 0 | 1;
  driftTime: number;
  boostTime: number;
  /** Spin-out time left: input is ignored. */
  spinTime: number;
  /** Time left held in place (pit work, respawn). */
  holdTime: number;
  /** Time left under the slowdown speed cap (SLA breach). */
  slowTime: number;
}

export type Surface = 'road' | 'offroad' | 'pit';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function spawnKart(track: Track, s: number, lateral: number): KartState {
  const c = track.pointAt(s);
  const t = track.tangentAt(s);
  return {
    pos: { x: c.x + lateral * t.z, z: c.z - lateral * t.x },
    heading: Math.atan2(t.x, t.z),
    speed: 0,
    driftDir: 0,
    driftTime: 0,
    boostTime: 0,
    spinTime: 0,
    holdTime: 0,
    slowTime: 0,
  };
}

export function driftStage(driftTime: number): 0 | 1 | 2 | 3 {
  const st = TUNING.driftStages;
  if (driftTime >= st[3]) return 3;
  if (driftTime >= st[2]) return 2;
  if (driftTime >= st[1]) return 1;
  return 0;
}

/**
 * The speed cap for the surface and the active effects. capScale scales the
 * kart's own top speed (bot skill and rubber-banding); the pit limit is fixed.
 */
function speedCap(k: KartState, surface: Surface, capScale: number): number {
  const top = TUNING.topSpeed * capScale;
  let cap = top;
  if (surface === 'offroad') cap = TUNING.offroadTopSpeed * capScale;
  if (k.boostTime > 0) cap = top * TUNING.boostFactor;
  if (surface === 'pit') cap = Math.min(cap, TUNING.pitSpeedLimit);
  if (k.slowTime > 0) cap = Math.min(cap, top * TUNING.slowFactor);
  return cap;
}

/** Move speed toward target by at most rate * dt. */
function approach(v: number, target: number, rate: number, dt: number): number {
  return v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
}

export function stepKart(
  k: KartState,
  input: KartInput,
  dt: number,
  surface: Surface,
  capScale = 1,
): KartState {
  const timers = {
    boostTime: Math.max(0, k.boostTime - dt),
    slowTime: Math.max(0, k.slowTime - dt),
  };

  if (k.holdTime > 0) {
    return {
      ...k,
      ...timers,
      speed: 0,
      driftDir: 0,
      driftTime: 0,
      holdTime: Math.max(0, k.holdTime - dt),
    };
  }

  const cap = speedCap(k, surface, capScale);
  let speed = k.speed;
  let heading = k.heading;
  let driftDir = k.driftDir;
  let driftTime = k.driftTime;
  let boostTime = timers.boostTime;
  const spinning = k.spinTime > 0;
  const inp = spinning ? { throttle: 0, brake: 0, steer: 0, drift: false } : input;
  const steer = clamp(inp.steer, -1, 1);

  // Longitudinal.
  if (spinning) {
    speed = approach(speed, 0, TUNING.spinDecel, dt);
  } else if (speed > cap) {
    speed = Math.max(cap, speed - TUNING.overCapDecel * dt);
  } else if (inp.throttle > 0 && speed >= 0) {
    const a = k.boostTime > 0 ? TUNING.boostAccel : TUNING.accel;
    speed = Math.min(cap, speed + a * inp.throttle * dt);
  } else if (inp.brake > 0) {
    if (speed > 0) speed = Math.max(0, speed - TUNING.brakeDecel * inp.brake * dt);
    else speed = Math.max(-TUNING.reverseSpeed, speed - TUNING.reverseAccel * inp.brake * dt);
  } else if (inp.throttle > 0) {
    speed = Math.min(0, speed + TUNING.brakeDecel * inp.throttle * dt); // throttle cancels reverse
  } else {
    speed = approach(speed, 0, TUNING.coastDecel, dt);
  }
  if (k.boostTime > 0 && !spinning && speed >= 0) {
    // A boost pushes even without throttle.
    speed = Math.min(cap, speed + TUNING.boostAccel * dt * (1 - inp.throttle));
  }

  // Drift: start, hold, release.
  if (driftDir === 0) {
    if (inp.drift && Math.abs(steer) > 0.3 && speed > TUNING.driftMinSpeed) {
      driftDir = steer > 0 ? 1 : -1;
      driftTime = 0;
    }
  } else if (!inp.drift || speed < TUNING.driftMinSpeed * 0.7) {
    const stage = inp.drift ? 0 : driftStage(driftTime); // too slow: no boost
    if (stage > 0) boostTime = Math.max(boostTime, TUNING.driftBoost[stage]);
    driftDir = 0;
    driftTime = 0;
  } else {
    driftTime += dt;
  }

  // Yaw.
  const abs = Math.abs(speed);
  const lowSpeed = clamp(abs / TUNING.fullSteerSpeed, 0, 1);
  const highSpeed = 1 - (1 - TUNING.highSpeedSteer) * clamp(abs / TUNING.topSpeed, 0, 1);
  const steerScale = lowSpeed * highSpeed * Math.sign(speed);
  let yaw: number;
  if (driftDir !== 0) {
    yaw = driftDir * TUNING.turnRate * (TUNING.driftYaw + TUNING.driftSteerGain * steer * driftDir);
  } else {
    yaw = steer * TUNING.turnRate * steerScale;
  }
  heading += yaw * dt;

  // Position.
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  let x = k.pos.x + fx * speed * dt;
  let z = k.pos.z + fz * speed * dt;
  if (driftDir !== 0) {
    // Slide out of the turn: to the right in a left drift.
    const slide = -driftDir * TUNING.driftSlide * speed * dt;
    x += fz * slide;
    z += -fx * slide;
  }

  return {
    pos: { x, z },
    heading,
    speed,
    driftDir,
    driftTime,
    boostTime,
    spinTime: Math.max(0, k.spinTime - dt),
    holdTime: 0,
    slowTime: timers.slowTime,
  };
}

/** True when s lies in [startS, endS]. The pit does not cross s = 0. */
const inSpan = (s: number, a: number, b: number) => s >= a && s <= b;

export function surfaceAt(p: Projection, track: Track): Surface {
  const { halfWidth, pit } = track.def;
  const side = p.lateral * pit.side;
  if (
    inSpan(p.s, pit.startS, pit.endS) &&
    side >= pit.centerOffset - pit.halfWidth &&
    side <= pit.centerOffset + pit.halfWidth
  ) {
    return 'pit';
  }
  return Math.abs(p.lateral) <= halfWidth ? 'road' : 'offroad';
}

/** Keep the kart inside the walls. A wall hit pushes the kart back and costs speed. */
export function constrainToTrack(k: KartState, p: Projection, track: Track): KartState {
  const { halfWidth, pit } = track.def;
  const outer = halfWidth + TUNING.offroadWidth;
  const side = p.lateral * pit.side; // > 0 on the pit side
  const inPitSpan = inSpan(p.s, pit.startS, pit.endS);
  const pitInner = pit.centerOffset - pit.halfWidth;
  const pitOuter = pit.centerOffset + pit.halfWidth;

  let target: number | null = null; // corrected lateral
  if (inPitSpan && side > 0) {
    const closed = p.s > pit.startS + pit.entryLen && p.s < pit.endS - pit.exitLen;
    if (side > pitOuter) target = pitOuter * pit.side;
    else if (closed && side > halfWidth && side < pitInner) {
      // Inside the divider: push to the nearer face.
      target = (side < (halfWidth + pitInner) / 2 ? halfWidth : pitInner) * pit.side;
    }
  } else if (Math.abs(p.lateral) > outer) {
    target = Math.sign(p.lateral) * outer;
  }
  if (target === null) return k;

  const t = track.tangentAt(p.s);
  const shift = target - p.lateral;
  const pos = { x: k.pos.x + shift * t.z, z: k.pos.z - shift * t.x };
  // Turn the kart halfway toward the wall's direction, so it scrapes along it.
  const trackHeading = Math.atan2(t.x, t.z);
  const along = trackHeading + (Math.cos(k.heading - trackHeading) < 0 ? Math.PI : 0);
  const d = Math.atan2(Math.sin(along - k.heading), Math.cos(along - k.heading));
  // A hit (steep or deep) costs speed by its severity. A scrape at a shallow
  // angle loses only the speed into the wall, so sliding along a wall while
  // steering into it does not grind the kart to a stop.
  const steep = Math.abs(Math.sin(d));
  const hit = steep > 0.25 || Math.abs(shift) > 0.5;
  const severity = clamp(Math.max(steep * 1.5, Math.abs(shift) / 1.5), 0, 1);
  const keep = hit ? 1 - (1 - TUNING.wallSpeedKeep) * severity : Math.cos(d);
  return {
    ...k,
    pos,
    heading: k.heading + d * 0.5,
    speed: k.speed * keep,
    driftDir: 0,
    driftTime: 0,
  };
}
