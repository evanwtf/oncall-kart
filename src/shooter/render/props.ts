import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../../render/textures';
import type { Shift } from '../logic/shift';

/**
 * Money and pickups on screen: bills in flight, lures (bills on the
 * floor), approved POs and the toolkit. Plus the money gun itself: a
 * cartoon cash blower in bright plastic, nothing like a firearm.
 */
export interface PropLayer {
  update(s: Shift, animTime: number): void;
  dispose(): void;
}

export interface GunView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** A shot: a short kick. */
  kick(): void;
  update(dt: number, aspect: number, working: boolean): void;
  dispose(): void;
}

const MAX_BILLS = 400;
const MAX_LURES = 96;
const MAX_POS = 8;
const BILL_HEIGHT = 1.25;

function billTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 28, (ctx, w, h) => {
    ctx.fillStyle = '#7bc47f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2e6b37';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#2e6b37';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8f5d0';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', w / 2, h / 2 + 1);
  });
}

function poTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(10, 18, w - 20, h - 26);
    ctx.fillStyle = '#9aa4ae';
    for (let y = 34; y < h - 20; y += 12) ctx.fillRect(18, y, w - 36, 3);
    ctx.fillStyle = '#b0b0b0';
    ctx.fillRect(w / 2 - 22, 4, 44, 16);
    ctx.save();
    ctx.translate(w / 2, h / 2 + 10);
    ctx.rotate(-0.3);
    ctx.strokeStyle = '#1f9d55';
    ctx.lineWidth = 5;
    ctx.strokeRect(-54, -18, 108, 36);
    ctx.fillStyle = '#1f9d55';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('APPROVED', 0, 1);
    ctx.restore();
  });
}

/** Geometry with a single vertex colour and no uv, ready to merge. */
function coloured(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  return g;
}

const part = (
  geo: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
) => {
  geo.rotateX(rx);
  geo.rotateY(ry);
  geo.rotateZ(rz);
  geo.translate(x, y, z);
  return coloured(geo, color);
};

export function createPropLayer(scene: THREE.Scene): PropLayer {
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const meshes: THREE.InstancedMesh[] = [];
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
    const m = new THREE.InstancedMesh(own(geo), own(mat), count);
    m.count = 0;
    m.frustumCulled = false;
    meshes.push(m);
    scene.add(m);
    return m;
  };

  const billMap = own(billTexture());
  const bills = instanced(
    new THREE.PlaneGeometry(0.15, 0.065),
    new THREE.MeshLambertMaterial({ map: billMap, side: THREE.DoubleSide }),
    MAX_BILLS,
  );
  // A lure: a few bills in a loose pile.
  const pile: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    pile.push(
      part(
        new THREE.BoxGeometry(0.2, 0.012, 0.09),
        i % 2 ? 0x7bc47f : 0x69b06d,
        Math.cos(a) * 0.08,
        0.008 + i * 0.012,
        Math.sin(a) * 0.08,
        0,
        a,
        0,
      ),
    );
  }
  const lures = instanced(
    merge(pile),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    MAX_LURES,
  );
  const poGeo = new THREE.BoxGeometry(0.32, 0.42, 0.03);
  const pos = instanced(
    poGeo,
    new THREE.MeshLambertMaterial({
      map: own(poTexture()),
      emissive: 0x1f3d2a,
    }),
    MAX_POS,
  );
  // The toolkit: a red tool case with a handle and latches.
  const kitGeo = merge([
    part(new THREE.BoxGeometry(0.5, 0.24, 0.26), 0xc0392b, 0, 0.12, 0),
    part(new THREE.BoxGeometry(0.52, 0.03, 0.28), 0x8e2a20, 0, 0.245, 0),
    part(new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI), 0x222222, 0, 0.26, 0),
    part(new THREE.BoxGeometry(0.04, 0.04, 0.02), 0xd0d0d0, -0.15, 0.2, 0.135),
    part(new THREE.BoxGeometry(0.04, 0.04, 0.02), 0xd0d0d0, 0.15, 0.2, 0.135),
  ]);
  const kit = new THREE.Mesh(
    own(kitGeo),
    own(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x220000 })),
  );
  kit.visible = false;
  scene.add(kit);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  return {
    update(s, animTime) {
      let n = 0;
      for (const b of s.bills) {
        if (n >= MAX_BILLS) break;
        // Flutter: each bill spins on its own.
        const t = animTime * 14 + b.id * 1.9;
        e.set(Math.sin(t) * 1.2, Math.atan2(b.vx, b.vz), Math.cos(t * 0.7) * 0.8);
        q.setFromEuler(e);
        p.set(b.x, BILL_HEIGHT + Math.sin(t * 0.5) * 0.05, b.z);
        m.compose(p, q, one);
        bills.setMatrixAt(n++, m);
      }
      bills.count = n;
      bills.instanceMatrix.needsUpdate = true;

      n = 0;
      for (const l of s.lures) {
        if (n >= MAX_LURES) break;
        q.setFromAxisAngle(p.set(0, 1, 0), l.id * 0.9);
        p.set(l.x, 0.01, l.z);
        m.compose(p, q, one);
        lures.setMatrixAt(n++, m);
      }
      lures.count = n;
      lures.instanceMatrix.needsUpdate = true;

      n = 0;
      kit.visible = false;
      for (const pk of s.pickups) {
        if (pk.respawnAt !== null) continue;
        const bob = Math.sin(animTime * 2.5 + pk.id) * 0.08;
        if (pk.kind === 'toolkit') {
          kit.visible = true;
          kit.position.set(pk.x, 0.35 + bob, pk.z);
          kit.rotation.y = animTime * 0.8;
          continue;
        }
        if (n >= MAX_POS) continue;
        q.setFromAxisAngle(p.set(0, 1, 0), animTime * 1.2 + pk.id);
        p.set(pk.x, 0.75 + bob, pk.z);
        m.compose(p, q, one);
        pos.setMatrixAt(n++, m);
      }
      pos.count = n;
      pos.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.dispose();
      }
      scene.remove(kit);
      for (const d of disposables) d.dispose();
    },
  };
}

/** The cash blower, drawn in its own pass over the floor so it never clips into a rack. */
export function createGun(): GunView {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(-1, 2, 1);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

  // Local space: -z points away from the player. A fat toy body, a bill
  // hopper on top, a wide flared nozzle and a chunky grip.
  const geo = merge([
    part(new THREE.CapsuleGeometry(0.075, 0.2, 4, 10), 0x2ec4b6, 0, 0, 0, Math.PI / 2),
    part(new THREE.BoxGeometry(0.13, 0.08, 0.14), 0xffd23f, 0, 0.1, 0.02),
    part(new THREE.BoxGeometry(0.11, 0.015, 0.08), 0x7bc47f, 0, 0.145, 0.02),
    part(
      new THREE.CylinderGeometry(0.11, 0.07, 0.12, 12, 1, true),
      0xff7f11,
      0,
      0,
      -0.2,
      -Math.PI / 2,
    ),
    part(new THREE.TorusGeometry(0.105, 0.015, 6, 16), 0xff7f11, 0, 0, -0.26),
    part(new THREE.BoxGeometry(0.06, 0.14, 0.07), 0x9b5de5, 0, -0.1, 0.06, 0.25),
    part(new THREE.SphereGeometry(0.03, 8, 6), 0xf15bb5, 0.08, 0.02, 0.04),
    part(
      new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10),
      0xffffff,
      -0.08,
      0.02,
      -0.02,
      0,
      0,
      Math.PI / 2,
    ),
  ]);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const gun = new THREE.Mesh(geo, material);
  const rest = new THREE.Vector3(0.3, -0.27, -0.72);
  gun.scale.setScalar(0.75);
  gun.position.copy(rest);
  gun.rotation.set(0.05, 0.12, 0);
  scene.add(gun);

  let kickT = 0;
  let sway = 0;
  let lower = 0;
  return {
    scene,
    camera,
    kick() {
      kickT = 1;
    },
    update(dt, aspect, working) {
      if (camera.aspect !== aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      kickT = Math.max(0, kickT - dt * 8);
      sway += dt;
      // Lowered while the player works at a rack: hands on the hardware.
      lower += ((working ? 1 : 0) - lower) * Math.min(1, dt * 10);
      gun.position.set(
        rest.x,
        rest.y + Math.sin(sway * 1.6) * 0.004 - lower * 0.25,
        rest.z + kickT * 0.06,
      );
      gun.rotation.x = 0.05 + kickT * 0.25;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
