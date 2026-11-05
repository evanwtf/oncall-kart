import { intBetween, pick, shuffle, type Rng } from '../../logic/rng';
import type { FloorDef } from './floor';
import { SHOOTER_TUNING } from './tuning';

/** A security patch to apply this shift. Every id and name here is made up. */
export interface Patch {
  /** For example 'ZD-2026-0042': a made-up advisory number, never a real one. */
  id: string;
  /** A made-up nickname, as advisories get. */
  name: string;
  targetId: string;
  applied: boolean;
}

/**
 * Made-up advisory nicknames. Edit freely, but keep them fictional: no real
 * vulnerability names, and nothing that sounds like one.
 */
export const PATCH_NAMES: readonly string[] = [
  'Polite Overflow',
  'Haunted Crontab',
  'Chatty Kernel',
  'Wobbly Ladder',
  'Lukewarm Coffee',
  'Forgotten Badge',
  'Midnight Pager',
  'Loose Lanyard',
  'Unlabelled Cable',
  'Squeaky Fan',
  'Optimistic Retry',
  'Friday Deploy',
  'Shared Password Sticky Note',
  'Eventual Consistency',
  'Default Admin',
];

/** The shift's patches: one switch, one firewall and one rack, in that order. */
export function rollPatches(rng: Rng, floor: FloorDef): Patch[] {
  const names = shuffle(rng, PATCH_NAMES);
  const ids = new Set<number>();
  const id = () => {
    let n = intBetween(rng, 1, 9999);
    while (ids.has(n)) n = (n % 9999) + 1;
    ids.add(n);
    return `ZD-2026-${String(n).padStart(4, '0')}`;
  };
  const targets = [
    pick(
      rng,
      floor.devices.filter((d) => d.kind === 'switch'),
    ),
    pick(
      rng,
      floor.devices.filter((d) => d.kind === 'firewall'),
    ),
    pick(rng, floor.racks),
  ].slice(0, SHOOTER_TUNING.patches);
  return targets.map((t, i) => ({
    id: id(),
    name: names[i] ?? `Patch ${i + 1}`,
    targetId: t.id,
    applied: false,
  }));
}
