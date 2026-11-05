import * as THREE from 'three';

const COUNT = 120;
/** Spark color by drift stage: grey, white, amber, cyan. */
const STAGE_COLORS = [0x8a96a3, 0xffffff, 0xffb347, 0x4fe3ff];

export interface Sparks {
  points: THREE.Points;
  /** Emit from (x, z) behind the kart while drifting, and move live sparks. */
  update(dt: number, emit: { x: number; z: number; heading: number; stage: number } | null): void;
  clear(): void;
  dispose(): void;
}

export function createSparks(): Sparks {
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const colAttr = new THREE.BufferAttribute(col, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  const mat = new THREE.PointsMaterial({
    size: 0.22,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let next = 0;
  const c = new THREE.Color();

  const hide = (i: number) => {
    pos[i * 3 + 1] = -100;
    life[i] = 0;
  };
  for (let i = 0; i < COUNT; i++) hide(i);

  return {
    points,
    update(dt, emit) {
      if (emit) {
        const n = 2 + emit.stage * 2;
        c.setHex(STAGE_COLORS[emit.stage] ?? 0xffffff);
        const fx = Math.sin(emit.heading);
        const fz = Math.cos(emit.heading);
        for (let k = 0; k < n; k++) {
          const i = next;
          next = (next + 1) % COUNT;
          const side = k % 2 ? 0.7 : -0.7;
          pos[i * 3] = emit.x - fx * 0.9 + fz * side;
          pos[i * 3 + 1] = 0.15;
          pos[i * 3 + 2] = emit.z - fz * 0.9 - fx * side;
          vel[i * 3] = -fx * 3 + (Math.random() - 0.5) * 3;
          vel[i * 3 + 1] = 1.5 + Math.random() * 2;
          vel[i * 3 + 2] = -fz * 3 + (Math.random() - 0.5) * 3;
          col[i * 3] = c.r;
          col[i * 3 + 1] = c.g;
          col[i * 3 + 2] = c.b;
          life[i] = 0.25 + Math.random() * 0.2;
        }
      }
      for (let i = 0; i < COUNT; i++) {
        const l = life[i] ?? 0;
        if (l <= 0) continue;
        const left = l - dt;
        if (left <= 0) {
          hide(i);
          continue;
        }
        life[i] = left;
        pos[i * 3] = (pos[i * 3] ?? 0) + (vel[i * 3] ?? 0) * dt;
        pos[i * 3 + 1] = Math.max(0.05, (pos[i * 3 + 1] ?? 0) + (vel[i * 3 + 1] ?? 0) * dt);
        pos[i * 3 + 2] = (pos[i * 3 + 2] ?? 0) + (vel[i * 3 + 2] ?? 0) * dt;
        vel[i * 3 + 1] = (vel[i * 3 + 1] ?? 0) - 12 * dt;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    },
    clear() {
      for (let i = 0; i < COUNT; i++) hide(i);
      posAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
