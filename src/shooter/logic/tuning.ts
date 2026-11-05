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

  // Vendors (phase 2).
  /** Cell size (m) of the grid vendors find their way on. */
  navCell: 0.5,
  /** A vendor's radius for collision with walls and racks. */
  vendorRadius: 0.3,
  /** Most vendors on the floor at once. An arrival beyond it waits. */
  maxVendors: 20,
  /** Vendors that arrive in one shift. */
  vendorArrivals: 16,
  /** Earliest and latest time of the first arrival. */
  firstArrivalMin: 12,
  firstArrivalMax: 18,
  /** No arrival after this time. */
  lastArrival: 165,
  /** A vendor this close (m) to the player slows the player (Evan's rule). */
  closeRange: 2,
  /** Speed taken off per close vendor, and the floor it stops at. */
  slowPerVendor: 0.2,
  slowFloor: 0.1,
  /** Inside this distance (m) of its goal a vendor stops walking. */
  vendorStopRange: 1,
  /** Gap (m) a vendor keeps from other vendors and from the player. */
  vendorGap: 0.6,
  /** A step without this much progress (m) in vendorStuckSeconds gets a nudge. */
  vendorStuckProgress: 0.2,
  vendorStuckSeconds: 3,
  /** How long (s) a nudge side-steps a stuck vendor. */
  vendorNudgeSeconds: 0.6,
  /** Shortest time (s) between two vendor lines. */
  vendorLineGap: 3,
  /** A wrong step calls vendors within alarmRange (m) to the rack for alarmSeconds. */
  alarmRange: 30,
  alarmSeconds: 8,

  // The money gun (phase 2).
  startBudget: 20000,
  /** Budget spent per shot. */
  shotCost: 500,
  /** Shots per second while the button is held. */
  fireRate: 4,
  /** At most this many clicks per second with no budget. */
  dryFireRate: 2,
  billsPerShot: 3,
  /** Spread of the bills either side of the view. */
  spreadDeg: 4,
  billSpeed: 25,
  billRange: 14,
  /** Bill radius for collision with walls and racks. */
  billRadius: 0.05,
  /** A hit distracts for distractSeconds × the role's distractScale. */
  distractSeconds: 5,
  /** A lure's life on the floor. */
  lureSeconds: 10,
  /** Bills of one shot that land this close (m) to its lure join it. */
  lureMerge: 1,
  /** A free vendor within lureRange (m) of a free lure goes for it. */
  lureRange: 6,
  /** A vendor this close (m) to its lure picks it up. */
  lureReach: 0.6,
  /** Seconds a vendor spends picking up a lure. */
  pickupSeconds: 2,
  /** Budget from one approved PO. */
  poAmount: 5000,
  /** Seconds before a PO comes back. */
  poRespawn: 30,
  /** The player takes a pickup within this distance (m). */
  pickupRadius: 0.8,
  /** Step time multiplier with the toolkit. */
  toolkitScale: 0.7,
} as const;
