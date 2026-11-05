import { NO_INPUT, type KartInput } from './kart';
import { raceProgress } from './lap';
import type { KartRuntime, Race } from './race';
import { hash01 } from './rng';
import { standings } from './standings';
import { nextStep } from './ticket';
import { wrapS, type Track } from './track';
import { TUNING } from './tuning';

/** One bot's skill. */
export interface BotProfile {
  /** Share of the normal top speed. */
  topSpeedScale: number;
  /** Amplitude (m) of the bot's wander off its chosen line. */
  lineNoise: number;
  /** Chance per gate row that the bot steers to a random gate. */
  wrongLaneChance: number;
  /** Chance per sharp corner that the bot drifts through it. */
  driftChance: number;
  /** Seconds the bot holds an item before it uses it. */
  itemDelay: number;
}

/** Seven profiles, from strong to weak. Bot n (kart id n) uses profile n - 1. */
export const BOT_PROFILES: readonly BotProfile[] = [
  { topSpeedScale: 0.915, lineNoise: 0.2, wrongLaneChance: 0.02, driftChance: 0.8, itemDelay: 0.6 },
  { topSpeedScale: 0.905, lineNoise: 0.3, wrongLaneChance: 0.04, driftChance: 0.7, itemDelay: 1 },
  { topSpeedScale: 0.895, lineNoise: 0.4, wrongLaneChance: 0.06, driftChance: 0.6, itemDelay: 1.5 },
  { topSpeedScale: 0.885, lineNoise: 0.5, wrongLaneChance: 0.08, driftChance: 0.5, itemDelay: 2 },
  { topSpeedScale: 0.875, lineNoise: 0.6, wrongLaneChance: 0.1, driftChance: 0.4, itemDelay: 2.5 },
  { topSpeedScale: 0.865, lineNoise: 0.7, wrongLaneChance: 0.13, driftChance: 0.3, itemDelay: 3 },
  { topSpeedScale: 0.855, lineNoise: 0.8, wrongLaneChance: 0.16, driftChance: 0.2, itemDelay: 3.5 },
];

/** The profile for a kart: its own, or the middle one for a kart without one. */
export function profileOf(k: KartRuntime): BotProfile {
  return BOT_PROFILES[k.botProfile ?? 3] ?? (BOT_PROFILES[3] as BotProfile);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const headingAt = (track: Track, s: number) => {
  const t = track.tangentAt(s);
  return Math.atan2(t.x, t.z);
};

/** The nearest gate row ahead of s: its index and the distance to it. */
function nextRow(race: Race, s: number): { index: number; dist: number } | null {
  let best: { index: number; dist: number } | null = null;
  race.board.forEach((row, index) => {
    const dist = wrapS(row.s - s, race.track.length);
    if (dist > 0 && (best === null || dist < best.dist)) best = { index, dist };
  });
  return best;
}

/** The lateral offset the bot aims for at a gate row. */
function gateLateral(race: Race, k: KartRuntime, rowIndex: number, profile: BotProfile): number {
  const row = race.board[rowIndex];
  if (!row || row.slots.length === 0) return 0;
  const seed = race.config.seed;
  const lap = k.lap.completed;
  const here = k.proj.lateral;
  const nearest = (lats: number[]) =>
    lats.reduce((a, b) => (Math.abs(b - here) < Math.abs(a - here) ? b : a));

  // A mistake: a random gate, decided once per row and lap.
  if (hash01(seed, k.id, lap, rowIndex, 1) < profile.wrongLaneChance) {
    const slot = row.slots[Math.floor(hash01(seed, k.id, lap, rowIndex, 2) * row.slots.length)];
    if (slot) return slot.lateral;
  }
  const want = nextStep(k.ticket);
  const match = row.slots.filter((sl) => sl.op === want).map((sl) => sl.lateral);
  if (match.length > 0) return nearest(match);
  // No gate for the next step (or it is PIT): an open lane between two gates.
  const sorted = [...row.slots].sort((a, b) => a.lateral - b.lateral);
  const lanes: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a && b) lanes.push((a.lateral + a.halfWidth + b.lateral - b.halfWidth) / 2);
  }
  if (lanes.length > 0) return nearest(lanes);
  const edge = race.track.def.halfWidth - TUNING.kartRadius;
  return here >= 0 ? edge : -edge;
}

/**
 * Steer round a cable patch ahead. A bot misses a patch with its
 * wrongLaneChance (once per patch and lap), so weak bots hit more of them.
 */
function avoidCables(race: Race, k: KartRuntime, lateral: number, profile: BotProfile): number {
  const { length, def } = race.track;
  let out = lateral;
  race.hazards.forEach((h, i) => {
    if (h.kind !== 'cable') return;
    const ahead = wrapS(h.s - k.proj.s, length);
    const inside = wrapS(k.proj.s - h.s, length) <= h.length;
    if (!inside && ahead > TUNING.botGateLookahead) return;
    if (hash01(race.config.seed, k.id, k.lap.completed, i, 4) < profile.wrongLaneChance) return;
    const clear = h.width / 2 + TUNING.kartRadius + 0.5;
    if (Math.abs(out - h.lateral) >= clear) return;
    const edge = def.halfWidth - TUNING.kartRadius;
    const left = Math.min(edge, h.lateral + clear);
    const right = Math.max(-edge, h.lateral - clear);
    // The side with more room, or the nearer side when both fit.
    const roomLeft = edge - (h.lateral + clear);
    const roomRight = h.lateral - clear + edge;
    if (roomLeft < 0) out = right;
    else if (roomRight < 0) out = left;
    else out = Math.abs(left - out) < Math.abs(right - out) ? left : right;
  });
  return out;
}

/** The lateral offset the bot wants for the pit, or null when it does not need the pit. */
function pitLateral(race: Race, k: KartRuntime): number | null {
  const { pit, halfWidth } = race.track.def;
  if (nextStep(k.ticket) !== 'PIT' || k.pitServedTicket === k.ticket.number) return null;
  const s = k.proj.s;
  const L = race.track.length;
  const toEntry = wrapS(pit.startS - s, L);
  const lane = pit.side * pit.centerOffset;
  // Approach: line up on the pit side of the road, then turn in at the opening.
  if (toEntry > 0 && toEntry <= TUNING.botPitLookahead) return pit.side * (halfWidth - 2);
  if (s >= pit.startS && s <= pit.startS + pit.entryLen) return lane;
  // Past the opening: stay in the lane only if the kart is in it.
  const inLane = k.proj.lateral * pit.side > halfWidth;
  if (s > pit.startS + pit.entryLen && s < pit.endS - pit.exitLen && inLane) return lane;
  return null;
}

/**
 * The bot's controls for this moment. A pure function of the race state:
 * the random choices come from hash01 of the seed, the kart, the lap and the
 * place, so they never depend on the frame rate or the call order.
 */
export function botInput(race: Race, kartId: number): KartInput {
  const k = race.karts[kartId];
  if (!k) return NO_INPUT;
  const profile = profileOf(k);
  const { track } = race;
  const { halfWidth } = track.def;
  const s = k.proj.s;
  const speed = k.kart.speed;
  const seed = race.config.seed;
  const lap = k.lap.completed;

  // The line: a home lane per bot, plus a slow wander.
  const home = ((k.id % 3) - 1) * halfWidth * 0.3;
  let lateral = home + profile.lineNoise * Math.sin(s / 17 + k.id * 2.1);
  const row = k.finishedAt === null ? nextRow(race, s) : null;
  if (row && row.dist <= TUNING.botGateLookahead) {
    lateral =
      gateLateral(race, k, row.index, profile) + 0.5 * profile.lineNoise * Math.sin(s / 7 + k.id);
  }
  lateral = avoidCables(race, k, lateral, profile);
  const pit = k.finishedAt === null ? pitLateral(race, k) : null;
  if (pit !== null) lateral = pit;

  // Steer at a point ahead on that line.
  const look = TUNING.botLookahead + Math.max(0, speed) * 0.4;
  const c = track.pointAt(s + look);
  const t = track.tangentAt(s + look);
  const aim = { x: c.x + lateral * t.z, z: c.z - lateral * t.x };
  const want = Math.atan2(aim.x - k.kart.pos.x, aim.z - k.kart.pos.z);
  const diff = wrapAngle(want - k.kart.heading);
  let steer = clamp(diff * TUNING.botSteerGain, -1, 1);

  // Speed: lift off when the kart points well away from its line.
  let throttle = 1;
  let brake = 0;
  if (Math.abs(diff) > 0.7 && speed > 10) {
    throttle = 0;
    brake = 0.4;
  } else if (Math.abs(diff) > 0.45 && speed > 14) {
    throttle = 0.3;
  }

  // Drift through sharp corners, with the profile's chance per corner.
  const turn = wrapAngle(headingAt(track, s + 25) - headingAt(track, s + 5));
  const dir = Math.sign(turn);
  const sharp = Math.abs(turn) > TUNING.botDriftTurn;
  let drift = false;
  if (k.kart.driftDir !== 0) {
    // Hold while the corner still turns the drift's way and the kart is not past its line.
    drift = turn * k.kart.driftDir > 0.25 && diff * k.kart.driftDir > -0.15;
  } else if (
    sharp &&
    pit === null &&
    speed > TUNING.driftMinSpeed + 2 &&
    hash01(seed, k.id, lap, Math.floor(s / 40), 3) < profile.driftChance
  ) {
    drift = true;
    steer = dir * Math.max(0.5, Math.abs(steer));
  }
  return { throttle, brake, steer, drift, item: wantsItem(race, k, profile) };
}

/** Use the item once it has been held for itemDelay. A leader keeps a Page: it has no target. */
function wantsItem(race: Race, k: KartRuntime, profile: BotProfile): boolean {
  if (k.item === null || k.finishedAt !== null || k.kart.spinTime > 0) return false;
  if (race.time - k.itemAt < profile.itemDelay) return false;
  return k.item !== 'page' || standings(race)[0] !== k.id;
}

/**
 * Rubber-banding, bots only: speedScale moves toward TUNING.rubberBand.max
 * when the bot is far behind the player and toward .min when it is far ahead.
 */
export function updateRubberBand(race: Race, k: KartRuntime, h: number): void {
  if (!k.isBot) return;
  const rb = TUNING.rubberBand;
  const player = race.karts[race.playerId];
  const { length, def } = race.track;
  let target = 1;
  if (player && player.finishedAt === null && k.finishedAt === null) {
    const gap =
      (raceProgress(k.lap, k.proj.s, length, def.sectorCount) -
        raceProgress(player.lap, player.proj.s, length, def.sectorCount)) *
      length;
    const f = clamp(gap / rb.range, -1, 1);
    target = f < 0 ? 1 - (rb.max - 1) * f : 1 - (1 - rb.min) * f;
  }
  const step = rb.rate * h;
  k.speedScale = clamp(
    k.speedScale < target
      ? Math.min(target, k.speedScale + step)
      : Math.max(target, k.speedScale - step),
    rb.min,
    rb.max,
  );
}
