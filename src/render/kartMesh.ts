import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Where one kart is drawn this frame. */
export interface KartPose {
  x: number;
  z: number;
  heading: number;
  /** Extra yaw of the body: spin-out and drift. */
  bodyYaw: number;
  /** Body lift (bob). */
  bodyY: number;
  /** Wheel roll angle. */
  wheelSpin: number;
  /** Firewall shell on. */
  shield: boolean;
}

/**
 * Every kart, drawn as instanced meshes: one per material, so 8 karts cost
 * the same few draw calls as one. A low-poly cart with an on-call engineer
 * in a hoodie and a headset.
 */
export interface KartFleet {
  group: THREE.Group;
  /** Karts drawn, up to the capacity. */
  setCount(n: number): void;
  setColor(i: number, color: number): void;
  setPose(i: number, pose: KartPose): void;
  /** Push the poses to the GPU. Call once per frame after setPose. */
  commit(): void;
  dispose(): void;
}

type Part = {
  geo: THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
};

function bake(parts: Part[]): THREE.BufferGeometry {
  const geos = parts.map((p) => {
    const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()) as THREE.BufferGeometry;
    p.geo.dispose();
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rx ?? 0, p.ry ?? 0, 0));
    m.setPosition(p.x, p.y, p.z);
    g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    return g;
  });
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('kartMesh: merge failed');
  return merged;
}

const WHEELS: ReadonlyArray<readonly [number, number]> = [
  [-0.72, 0.7],
  [0.72, 0.7],
  [-0.72, -0.7],
  [0.72, -0.7],
];

export function buildFleet(capacity: number): KartFleet {
  const group = new THREE.Group();
  const mat = (c: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, flatShading: true, ...extra });
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (a: number, b: number, h: number, n: number, open = false) =>
    new THREE.CylinderGeometry(a, b, h, n, 1, open);

  const frame = bake([{ geo: box(1.3, 0.25, 2.1), x: 0, y: 0.35, z: 0 }]);
  const dark = bake([
    { geo: box(1.4, 0.2, 0.25), x: 0, y: 0.35, z: 1.1 },
    { geo: box(0.8, 0.6, 0.15), x: 0, y: 0.75, z: -0.55 },
    {
      geo: new THREE.TorusGeometry(0.22, 0.03, 4, 10, Math.PI),
      x: 0,
      y: 1.45,
      z: -0.2,
      ry: Math.PI / 2,
    },
    { geo: box(0.06, 0.14, 0.12), x: -0.22, y: 1.42, z: -0.2 },
    { geo: box(0.06, 0.14, 0.12), x: 0.22, y: 1.42, z: -0.2 },
    { geo: box(0.02, 0.02, 0.2), x: 0.18, y: 1.34, z: -0.08, ry: 0.5 },
  ]);
  // A small server-blade box strapped on the back: the spare part.
  const blade = bake([{ geo: box(0.7, 0.25, 0.35), x: 0, y: 0.6, z: -0.85 }]);
  const skin = bake([{ geo: new THREE.IcosahedronGeometry(0.2, 0), x: 0, y: 1.42, z: -0.2 }]);
  // The driver color: the hoodie, the hood, the arms and the nose panel.
  const hoodie = bake([
    { geo: cyl(0.26, 0.32, 0.6, 6), x: 0, y: 0.95, z: -0.25 },
    { geo: cyl(0.24, 0.27, 0.18, 6, true), x: 0, y: 1.28, z: -0.28 },
    { geo: cyl(0.07, 0.07, 0.5, 5), x: -0.3, y: 0.98, z: 0, rx: Math.PI / 3 },
    { geo: cyl(0.07, 0.07, 0.5, 5), x: 0.3, y: 0.98, z: 0, rx: Math.PI / 3 },
    { geo: box(1.0, 0.18, 0.7), x: 0, y: 0.55, z: 0.7 },
  ]);
  const wheel = cyl(0.28, 0.28, 0.22, 8);
  wheel.rotateZ(Math.PI / 2);
  // The Firewall: a translucent hexagonal shell.
  const shell = new THREE.CylinderGeometry(1.5, 1.5, 1.9, 6, 1, true);
  shell.translate(0, 0.9, 0);

  const darkMat = mat(0x14181d);
  const meshes = {
    frame: new THREE.InstancedMesh(frame, mat(0x2a3038, { metalness: 0.4 }), capacity),
    dark: new THREE.InstancedMesh(dark, darkMat, capacity),
    blade: new THREE.InstancedMesh(blade, mat(0x5b6878), capacity),
    skin: new THREE.InstancedMesh(skin, mat(0xc99b7a), capacity),
    hoodie: new THREE.InstancedMesh(hoodie, mat(0xffffff, { emissive: 0x222222 }), capacity),
  };
  const wheels = new THREE.InstancedMesh(wheel, darkMat, capacity * 4);
  const shields = new THREE.InstancedMesh(
    shell,
    new THREE.MeshBasicMaterial({
      color: 0x6fd3ff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    capacity,
  );
  const all = [...Object.values(meshes), wheels, shields];
  for (const m of all) {
    m.frustumCulled = false;
    m.castShadow = m !== shields;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }
  for (let i = 0; i < capacity; i++) meshes.hoodie.setColorAt(i, new THREE.Color(0xffffff));

  let count = 0;
  let shieldCount = 0;
  const kart = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const tmp2 = new THREE.Matrix4();
  const color = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  const setCount = (n: number) => {
    count = Math.max(0, Math.min(capacity, n));
    for (const m of Object.values(meshes)) m.count = count;
    wheels.count = count * 4;
  };
  setCount(0);

  return {
    group,
    setCount,
    setColor(i, c) {
      meshes.hoodie.setColorAt(i, color.setHex(c));
      if (meshes.hoodie.instanceColor) meshes.hoodie.instanceColor.needsUpdate = true;
    },
    setPose(i, p) {
      if (i >= count) return;
      kart.makeRotationY(p.heading).setPosition(p.x, 0, p.z);
      tmp.makeRotationY(p.bodyYaw).setPosition(0, p.bodyY, 0);
      kart.multiply(tmp);
      for (const m of Object.values(meshes)) m.setMatrixAt(i, kart);
      WHEELS.forEach(([x, z], w) => {
        tmp.makeRotationX(p.wheelSpin).setPosition(x, 0.28, z);
        wheels.setMatrixAt(i * 4 + w, tmp2.multiplyMatrices(kart, tmp));
      });
      if (p.shield) shields.setMatrixAt(shieldCount++, kart);
    },
    commit() {
      shields.count = shieldCount;
      for (let i = shieldCount; i < capacity; i++) shields.setMatrixAt(i, hidden);
      shieldCount = 0;
      for (const m of all) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      const mats = new Set<THREE.Material>();
      for (const m of all) {
        m.geometry.dispose();
        mats.add(m.material as THREE.Material);
        m.dispose();
      }
      for (const m of mats) m.dispose();
      group.clear();
    },
  };
}
