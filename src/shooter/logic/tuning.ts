/**
 * Every tunable number in the shooter's logic: starting values, tune by feel.
 * Units: metres, seconds, radians unless the name says degrees.
 */
export const SHOOTER_TUNING = {
  // The shift.
  shiftSeconds: 180,
  /** Servers that break in one shift. */
  breaks: 6,
  /** Time of the first break. */
  firstBreak: 10,
  /** No break in the last quietEnd seconds. */
  quietEnd: 15,
  /** Shortest time between two breaks. */
  minBreakGap: 8,

  // Tickets. SLA = slaBase + slaPerStep * number of steps.
  slaBase: 35,
  slaPerStep: 7,

  // Work at a rack or a patch target: seconds to fill the bar.
  opSeconds: 2,
  handsOnSeconds: 4,
  patchSeconds: 3,
  /** Patches in one shift. */
  patches: 3,

  // The player.
  runSpeed: 6,
  /** m/s²: full speed in 0.1 s, and a stop just as fast. */
  accel: 60,
  playerRadius: 0.35,
  eyeHeight: 1.6,
  /** Largest distance (m) from the player to a target's box for work. */
  reach: 1.8,
  /** Largest angle between the view and the target's front face for work. */
  faceAngleDeg: 35,
  /** Radians per pixel of mouse movement. */
  mouseSensitivity: 0.0025,
  pitchLimitDeg: 80,
} as const;
