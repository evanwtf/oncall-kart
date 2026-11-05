import { NO_INPUT, type KartInput } from '../src/logic/kart';
import type { Race } from '../src/logic/race';

/** A scripted driver: steer toward the centerline 15 m ahead, full throttle. */
export function scriptedInput(race: Race, kartId = 0, lookAhead = 15): KartInput {
  const k = race.karts[kartId];
  if (!k) return NO_INPUT;
  const target = race.track.pointAt(k.proj.s + lookAhead);
  const want = Math.atan2(target.x - k.kart.pos.x, target.z - k.kart.pos.z);
  const diff = Math.atan2(Math.sin(want - k.kart.heading), Math.cos(want - k.kart.heading));
  return { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, diff * 2.5)), drift: false };
}
