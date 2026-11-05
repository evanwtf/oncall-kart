import type { KartRuntime } from './race';
import { TUNING } from './tuning';

export type HitKind = 'wrong-gate' | 'page' | 'spill' | 'cable' | 'cron';

/**
 * What a hit did. 'ignored': the kart was already spinning, so the hit
 * missed it and consumed nothing (no stun-lock).
 */
export type HitOutcome = 'blocked' | 'rolled-back' | 'spun' | 'ignored';

/**
 * Resolve one hit on a kart. The order is fixed: a kart that spins is not hit
 * again; then the Firewall blocks any hit but a wrong gate, and drops; then
 * an armed Rollback cancels any hit, and disarms; else the kart spins for
 * that kind's time. Mutates the kart.
 */
export function applyHit(k: KartRuntime, kind: HitKind): HitOutcome {
  if (k.kart.spinTime > 0) return 'ignored';
  if (kind !== 'wrong-gate' && k.shieldTime > 0) {
    k.shieldTime = 0;
    return 'blocked';
  }
  if (k.rollbackArmed) {
    k.rollbackArmed = false;
    return 'rolled-back';
  }
  k.kart = { ...k.kart, spinTime: TUNING.hitSpin[kind], driftDir: 0, driftTime: 0 };
  return 'spun';
}
