import { describe, expect, it } from 'vitest';
import type { Box } from '../../src/shooter/logic/floor';
import { moveWithCollision, stepPlayer, type Player } from '../../src/shooter/logic/player';
import { SHOOTER_TUNING } from '../../src/shooter/logic/tuning';

const R = SHOOTER_TUNING.playerRadius;
/** A long wall whose west face is at x = 5: a strafing player slides along it. */
const WALL: Box = { minX: 5, maxX: 6, minZ: -1000, maxZ: 1000 };

const inside = (p: { x: number; z: number }, b: Box, r: number) =>
  p.x > b.minX - r + 1e-9 &&
  p.x < b.maxX + r - 1e-9 &&
  p.z > b.minZ - r + 1e-9 &&
  p.z < b.maxZ + r - 1e-9;

const player = (over: Partial<Player> = {}): Player => ({
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  ...over,
});

describe('moveWithCollision', () => {
  it('moves freely with nothing in the way', () => {
    expect(moveWithCollision({ x: 0, z: 0 }, 1, -2, R, [WALL])).toEqual({ x: 1, z: -2 });
  });

  it('stops at the face minus the radius', () => {
    const p = moveWithCollision({ x: 5 - R - 0.5, z: 0 }, 1, 0, R, [WALL]);
    expect(p.x).toBeCloseTo(5 - R);
    expect(p.z).toBe(0);
  });

  it('does not tunnel through a thin wall on a long move', () => {
    const thin: Box = { minX: 5, maxX: 5.1, minZ: -10, maxZ: 10 };
    const p = moveWithCollision({ x: 0, z: 0 }, 20, 0, R, [thin]);
    expect(p.x).toBeCloseTo(5 - R);
  });

  it('keeps the component along the wall on a diagonal move', () => {
    const p = moveWithCollision({ x: 5 - R - 0.1, z: 0 }, 1, 1, R, [WALL]);
    expect(p.x).toBeCloseTo(5 - R);
    expect(p.z).toBeCloseTo(1);
  });

  it('stops on each face from every side', () => {
    const b: Box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    expect(moveWithCollision({ x: 3, z: 0 }, -3, 0, R, [b]).x).toBeCloseTo(1 + R);
    expect(moveWithCollision({ x: 0, z: -3 }, 0, 3, R, [b]).z).toBeCloseTo(-1 - R);
    expect(moveWithCollision({ x: 0, z: 3 }, 0, -3, R, [b]).z).toBeCloseTo(1 + R);
  });
});

describe('stepPlayer', () => {
  it('never ends inside a box after 10 s of walking into a wall', () => {
    // Face +x (yaw -90 degrees) and walk forward into the wall, at an angle too.
    for (const strafe of [0, 1, -1]) {
      const p = player({ x: 2, yaw: -Math.PI / 2 });
      for (let i = 0; i < 1200; i++) {
        stepPlayer(p, { forward: 1, strafe }, 1 / 120, [WALL]);
        expect(inside(p, WALL, R)).toBe(false);
      }
      expect(p.x).toBeCloseTo(5 - R);
    }
  });

  it('reaches 0.9 of run speed within 0.2 s', () => {
    const p = player();
    for (let i = 0; i < 24; i++) stepPlayer(p, { forward: 1, strafe: 0 }, 1 / 120, []);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThanOrEqual(0.9 * SHOOTER_TUNING.runSpeed);
  });

  it('moves along (-sin yaw, -cos yaw) for forward', () => {
    const p = player({ yaw: 0 });
    for (let i = 0; i < 120; i++) stepPlayer(p, { forward: 1, strafe: 0 }, 1 / 120, []);
    expect(p.z).toBeLessThan(-4);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    const q = player({ yaw: 0 });
    for (let i = 0; i < 120; i++) stepPlayer(q, { forward: 0, strafe: 1 }, 1 / 120, []);
    // Strafe right of a player facing -z is +x.
    expect(q.x).toBeGreaterThan(4);
  });

  it('never exceeds run speed with forward and strafe together', () => {
    const p = player({ yaw: 0.7 });
    for (let i = 0; i < 240; i++) {
      stepPlayer(p, { forward: 1, strafe: 1 }, 1 / 120, []);
      expect(Math.hypot(p.vx, p.vz)).toBeLessThanOrEqual(SHOOTER_TUNING.runSpeed + 1e-9);
    }
  });

  it('stops when the input stops', () => {
    const p = player();
    for (let i = 0; i < 60; i++) stepPlayer(p, { forward: 1, strafe: 0 }, 1 / 120, []);
    for (let i = 0; i < 60; i++) stepPlayer(p, { forward: 0, strafe: 0 }, 1 / 120, []);
    expect(Math.hypot(p.vx, p.vz)).toBe(0);
  });

  it('drops the velocity into a wall, so the player does not stick to it', () => {
    const p = player({ x: 2, yaw: -Math.PI / 2 });
    for (let i = 0; i < 240; i++) stepPlayer(p, { forward: 1, strafe: 0 }, 1 / 120, [WALL]);
    expect(p.vx).toBe(0);
  });
});
