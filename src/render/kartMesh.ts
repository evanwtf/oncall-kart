import * as THREE from 'three';

export interface KartMesh {
  group: THREE.Group;
  /** The body, tilted and spun for effects; the group carries position and heading. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  setColor(color: number): void;
  dispose(): void;
}

/** A small low-poly cart with an on-call engineer in a hoodie and a headset. */
export function buildKart(color: number): KartMesh {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const disposables: { dispose(): void }[] = [];
  const mat = (c: number, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.6,
      flatShading: true,
      ...extra,
    });
    disposables.push(m);
    return m;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    body.add(mesh);
    return mesh;
  };

  const frame = mat(0x2a3038, { metalness: 0.4 });
  const hoodie = mat(color);
  const skin = mat(0xc99b7a);
  const dark = mat(0x14181d);
  const accent = mat(color, { emissive: color, emissiveIntensity: 0.25 });

  // Chassis, bumper, seat back and a nose panel in the driver color.
  add(new THREE.BoxGeometry(1.3, 0.25, 2.1), frame, 0, 0.35, 0);
  add(new THREE.BoxGeometry(1.4, 0.2, 0.25), dark, 0, 0.35, 1.1);
  add(new THREE.BoxGeometry(1.0, 0.18, 0.7), accent, 0, 0.55, 0.7);
  add(new THREE.BoxGeometry(0.8, 0.6, 0.15), dark, 0, 0.75, -0.55);
  // A small server-blade box strapped on the back: the spare part.
  add(new THREE.BoxGeometry(0.7, 0.25, 0.35), mat(0x5b6878), 0, 0.6, -0.85);

  // Driver: torso (hoodie), hood, head, headset band and ear cups, arms.
  add(new THREE.CylinderGeometry(0.26, 0.32, 0.6, 6), hoodie, 0, 0.95, -0.25);
  add(new THREE.IcosahedronGeometry(0.2, 0), skin, 0, 1.42, -0.2);
  add(new THREE.CylinderGeometry(0.24, 0.27, 0.18, 6, 1, true), hoodie, 0, 1.28, -0.28);
  const band = add(new THREE.TorusGeometry(0.22, 0.03, 4, 10, Math.PI), dark, 0, 1.45, -0.2);
  band.rotation.y = Math.PI / 2;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 0.14, 0.12), dark, side * 0.22, 1.42, -0.2);
    const arm = add(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 5), hoodie, side * 0.3, 0.98, 0.0);
    arm.rotation.x = Math.PI / 3;
  }
  // Mic boom.
  const boom = add(new THREE.BoxGeometry(0.02, 0.02, 0.2), dark, 0.18, 1.34, -0.08);
  boom.rotation.y = 0.5;

  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 8);
  wheelGeo.rotateZ(Math.PI / 2);
  disposables.push(wheelGeo);
  for (const [x, z] of [
    [-0.72, 0.7],
    [0.72, 0.7],
    [-0.72, -0.7],
    [0.72, -0.7],
  ] as const) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.28, z);
    body.add(w);
    wheels.push(w);
  }

  return {
    group,
    body,
    wheels,
    setColor(c: number) {
      hoodie.color.setHex(c);
      accent.color.setHex(c);
      accent.emissive.setHex(c);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
