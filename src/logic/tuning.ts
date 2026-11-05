import type { TicketType } from './runbooks';

/** Every tunable number in the game logic. Units: metres, seconds, radians. */
export const TUNING = {
  // Tickets. SLA time = slaBase + slaPerStep * number of steps.
  slaBase: 30,
  slaPerStep: 15,
  /** Share of gate rows with 2 gates; the rest have 3. 0: every row has 3. */
  twoGateRowShare: 0,

  // Speed, in m/s and m/s².
  topSpeed: 21,
  accel: 12,
  brakeDecel: 30,
  coastDecel: 4,
  /** Deceleration toward a lower cap (off-road, pit, slowdown, end of boost). */
  overCapDecel: 20,
  reverseSpeed: 6,
  reverseAccel: 8,
  offroadTopSpeed: 10,
  pitSpeedLimit: 18,
  /** Off-road strip beside the road, out to the soft wall. */
  offroadWidth: 5,
  /** Share of speed a kart keeps when it hits a wall. */
  wallSpeedKeep: 0.55,

  // Steering, in rad/s.
  turnRate: 2.1,
  /** Steering at top speed, as a share of turnRate. */
  highSpeedSteer: 0.55,
  /** Speed at which steering reaches full strength. */
  fullSteerSpeed: 6,

  // Drift.
  driftMinSpeed: 10,
  /** Drift time (s) to reach stage 0, 1, 2 and 3. */
  driftStages: [0, 0.6, 1.3, 2.1] as const,
  /** Boost time (s) on release at stage 0, 1, 2 and 3. */
  driftBoost: [0, 0.5, 0.9, 1.4] as const,
  /** Yaw while drifting, as a share of turnRate, at neutral steer. */
  driftYaw: 1.0,
  /** How much steer tightens or widens a drift. */
  driftSteerGain: 0.45,
  /** Sideways slide out of the turn, as a share of speed. */
  driftSlide: 0.12,

  // Boost and slowdowns.
  boostFactor: 1.3,
  boostAccel: 30,
  slowFactor: 0.6,
  spinDecel: 22,

  // Kart-to-kart contact.
  /** Every kart is a circle of this radius (m) for contact. */
  kartRadius: 1,
  /** Bounce in a kart-to-kart hit: 0 is dead, 1 is fully elastic. */
  contactRestitution: 0.3,

  // Race.
  countdown: 3,
  /** Spin after a wrong gate: the time penalty. */
  wrongGateSpin: 0.9,
  ticketCloseBoost: 1.2,
  /** Time held at the pit box while the tech works. */
  pitHold: 1,
  /** Slowdown after an SLA breach. */
  slaSlow: 2.5,
  respawnHold: 0.8,
  /** Seconds off the road before an automatic respawn. */
  offroadRespawn: 4,
  /** Seconds under throttle at near-zero speed before an automatic respawn. */
  stuckRespawn: 2.5,
  /** Below this speed (m/s) a kart under throttle counts as stuck. */
  stuckSpeed: 1,
  /**
   * Largest dt one stepRace call accepts; a longer dt is cut to this. The game
   * loop has its own catch-up limit (MAX_CATCH_UP in game.ts) and calls
   * stepRace once per fixed step.
   */
  maxFrame: 0.1,
  /** Fixed logic step. */
  step: 1 / 120,
};

export function slaSeconds(type: TicketType): number {
  return TUNING.slaBase + TUNING.slaPerStep * type.steps.length;
}
