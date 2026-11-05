import { applyHit, type HitKind } from './penalty';
import type { KartRuntime, Race, RaceEvent } from './race';
import type { Rng } from './rng';
import { standings } from './standings';
import { forwardDelta, wrapS } from './track';
import { TUNING } from './tuning';

export const ITEM_KINDS = ['coffee', 'rollback', 'firewall', 'page', 'spill'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** A change-request crate. It is live when the race time reaches respawnAt. */
export interface ItemBox {
  s: number;
  lateral: number;
  respawnAt: number;
}

/** A Page in flight. targetId null: it has no target and flies on until its life ends. */
export interface Projectile {
  id: number;
  ownerId: number;
  targetId: number | null;
  s: number;
  lateral: number;
  speed: number;
  life: number;
}

/** A coffee puddle on the road. */
export interface Puddle {
  id: number;
  ownerId: number;
  s: number;
  lateral: number;
  life: number;
}

/** Item weights for the leader and for the last kart; places between blend them. */
const LEAD_WEIGHTS: Record<ItemKind, number> = {
  coffee: 2,
  rollback: 2,
  firewall: 4,
  page: 1,
  spill: 4,
};
const LAST_WEIGHTS: Record<ItemKind, number> = {
  coffee: 4,
  rollback: 2,
  firewall: 1,
  page: 5,
  spill: 1,
};

/**
 * Roll an item for a kart in `place` (1 is first) of `field` karts. Trailing
 * karts get more Coffee and Page; leaders get more Firewall and Spill.
 */
export function rollItem(rng: Rng, place: number, field: number): ItemKind {
  const t = field > 1 ? Math.max(0, Math.min(1, (place - 1) / (field - 1))) : 0.5;
  const w = ITEM_KINDS.map((kind) => LEAD_WEIGHTS[kind] * (1 - t) + LAST_WEIGHTS[kind] * t);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    r -= w[i] as number;
    if (r < 0) return ITEM_KINDS[i] as ItemKind;
  }
  return ITEM_KINDS[ITEM_KINDS.length - 1] as ItemKind;
}

/** Give the kart a rolled item, if it holds none. */
export function giveItem(race: Race, k: KartRuntime, events: RaceEvent[]): void {
  if (k.item !== null) return;
  const place = standings(race).indexOf(k.id) + 1;
  k.item = rollItem(race.rng, place, race.karts.length);
  k.itemAt = race.time;
  events.push({ type: 'item-picked', kartId: k.id, item: k.item });
}

/** Distance in track space (along, across): close to the true distance at these sizes. */
function trackDist(track: Race['track'], s1: number, l1: number, s2: number, l2: number): number {
  return Math.hypot(forwardDelta(s1, s2, track.length), l2 - l1);
}

/** A kart without an item picks up a live box it touches. */
export function collectBoxes(race: Race, k: KartRuntime, events: RaceEvent[]): void {
  if (k.item !== null) return;
  for (const box of race.boxes) {
    if (race.time < box.respawnAt) continue;
    if (trackDist(race.track, box.s, box.lateral, k.proj.s, k.proj.lateral) > TUNING.boxRadius) {
      continue;
    }
    box.respawnAt = race.time + TUNING.boxRespawn;
    giveItem(race, k, events);
    return;
  }
}

/** The kart a Page from this kart targets: the next kart ahead, unless it finished. */
function pageTarget(race: Race, k: KartRuntime): number | null {
  const order = standings(race);
  const i = order.indexOf(k.id);
  const ahead = i > 0 ? race.karts[order[i - 1] as number] : undefined;
  return ahead && ahead.finishedAt === null && ahead.id !== k.id ? ahead.id : null;
}

/** Use the kart's item. Returns the events; an empty list when it holds none. */
export function useItem(race: Race, kartId: number): RaceEvent[] {
  const k = race.karts[kartId];
  if (!k || k.item === null) return [];
  const item = k.item;
  k.item = null;
  switch (item) {
    case 'coffee':
      k.kart = { ...k.kart, boostTime: k.kart.boostTime + TUNING.coffeeBoost };
      break;
    case 'rollback':
      k.rollbackArmed = true;
      break;
    case 'firewall':
      k.shieldTime = TUNING.shieldTime;
      break;
    case 'page': {
      const targetId = pageTarget(race, k);
      race.projectiles.push({
        id: race.nextEntityId++,
        ownerId: k.id,
        targetId,
        s: wrapS(k.proj.s + TUNING.kartRadius + 0.5, race.track.length),
        lateral: k.proj.lateral,
        speed: TUNING.pageSpeed,
        life: targetId === null ? TUNING.pageLife : TUNING.pageSeekLife,
      });
      break;
    }
    case 'spill':
      race.puddles.push({
        id: race.nextEntityId++,
        ownerId: k.id,
        s: wrapS(k.proj.s - TUNING.spillOffset, race.track.length),
        lateral: k.proj.lateral,
        life: TUNING.spillLife,
      });
      break;
  }
  return [{ type: 'item-used', kartId, item }];
}

/** Hit a kart and report it. An ignored hit (the kart spins already) makes no event. */
export function hitKart(
  k: KartRuntime,
  kind: HitKind,
  byId: number | null,
  events: RaceEvent[],
): void {
  const outcome = applyHit(k, kind);
  if (outcome !== 'ignored') events.push({ type: 'hit', kartId: k.id, kind, outcome, byId });
}

/** A kart that touches a puddle is hit by it, and the puddle is gone. */
export function hitPuddles(race: Race, k: KartRuntime, events: RaceEvent[]): void {
  const reach = TUNING.puddleRadius + TUNING.kartRadius;
  for (const pd of [...race.puddles]) {
    if (trackDist(race.track, pd.s, pd.lateral, k.proj.s, k.proj.lateral) > reach) continue;
    race.puddles = race.puddles.filter((x) => x !== pd);
    hitKart(k, 'spill', pd.ownerId, events);
  }
}

/** Move every Page and resolve its hit; dry up old puddles. */
export function stepProjectiles(race: Race, h: number, events: RaceEvent[]): void {
  const L = race.track.length;
  const kept: Projectile[] = [];
  for (const pg of race.projectiles) {
    let target = pg.targetId === null ? undefined : race.karts[pg.targetId];
    if (pg.targetId !== null && (!target || target.finishedAt !== null)) {
      // The target finished: fly on without one.
      pg.targetId = null;
      pg.life = Math.min(pg.life, TUNING.pageLife);
      target = undefined;
    }
    pg.s = wrapS(pg.s + pg.speed * h, L);
    pg.life -= h;
    if (target) {
      const turn = TUNING.pageTurn * h;
      const d = target.proj.lateral - pg.lateral;
      pg.lateral += Math.max(-turn, Math.min(turn, d));
      // It homes: reaching the target, or passing it this substep, within
      // TUNING.pageHitGap across, is a hit.
      const ahead = wrapS(target.proj.s - pg.s, L);
      const along = ahead <= TUNING.kartRadius || ahead >= L - pg.speed * h - TUNING.kartRadius;
      if (along && Math.abs(target.proj.lateral - pg.lateral) <= TUNING.pageHitGap) {
        hitKart(target, 'page', pg.ownerId, events);
        continue;
      }
    }
    if (pg.life > 0) kept.push(pg);
  }
  race.projectiles = kept;
  for (const pd of race.puddles) pd.life -= h;
  race.puddles = race.puddles.filter((pd) => pd.life > 0);
}
