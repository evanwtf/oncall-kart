import type { KartState } from './kart';
import { TUNING } from './tuning';

/**
 * Kart-to-kart contact. Every kart is a circle of radius TUNING.kartRadius.
 * Two karts that overlap move apart by the same distance, along the line
 * between their centers. When they close on each other, they exchange part
 * of the speed along that line (a soft collision, TUNING.contactRestitution).
 * Mutates the karts.
 */
export function resolveContacts(karts: ReadonlyArray<{ kart: KartState }>): void {
  const min = 2 * TUNING.kartRadius;
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      if (!a || !b) continue;
      const dx = b.kart.pos.x - a.kart.pos.x;
      const dz = b.kart.pos.z - a.kart.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      // The normal from a to b. Two karts at the same point split along a's heading.
      const nx = d > 1e-9 ? dx / d : Math.sin(a.kart.heading);
      const nz = d > 1e-9 ? dz / d : Math.cos(a.kart.heading);
      const push = (min - d) / 2;

      // Velocities in the plane, then the closing speed along the normal.
      const fa = { x: Math.sin(a.kart.heading), z: Math.cos(a.kart.heading) };
      const fb = { x: Math.sin(b.kart.heading), z: Math.cos(b.kart.heading) };
      const va = { x: fa.x * a.kart.speed, z: fa.z * a.kart.speed };
      const vb = { x: fb.x * b.kart.speed, z: fb.z * b.kart.speed };
      const closing = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
      let speedA = a.kart.speed;
      let speedB = b.kart.speed;
      if (closing > 0) {
        const j = ((1 + TUNING.contactRestitution) / 2) * closing;
        // A kart keeps only the speed along its own heading.
        speedA = (va.x - j * nx) * fa.x + (va.z - j * nz) * fa.z;
        speedB = (vb.x + j * nx) * fb.x + (vb.z + j * nz) * fb.z;
      }
      a.kart = {
        ...a.kart,
        pos: { x: a.kart.pos.x - nx * push, z: a.kart.pos.z - nz * push },
        speed: speedA,
      };
      b.kart = {
        ...b.kart,
        pos: { x: b.kart.pos.x + nx * push, z: b.kart.pos.z + nz * push },
        speed: speedB,
      };
    }
  }
}
