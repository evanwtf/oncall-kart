import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../../render/textures';
import type { Shift } from '../logic/shift';
import { SHOOTER_TUNING } from '../logic/tuning';
import { VENDOR_ROLES, type VendorRole } from '../logic/vendors';

/**
 * Vendors on screen: low-poly figures in business-casual clothes, each with
 * a lanyard and a role prop. Job roles only: no logos, no faces, nobody
 * real. One InstancedMesh per part, so draw calls do not grow with the
 * number of vendors.
 */
export interface VendorLayer {
  capture(s: Shift): void;
  reset(): void;
  update(s: Shift, alpha: number, animTime: number, camera: THREE.Camera): void;
  dispose(): void;
}

const MAX = SHOOTER_TUNING.maxVendors;
/** "$" sprites over each distracted vendor. */
const DOLLARS_EACH = 3;
/** Role tags show within this distance (m). */
const TAG_RANGE = 8;
const ROLES = Object.keys(VENDOR_ROLES) as VendorRole[];
/** How fast a vendor turns to face the player (1/s). */
const TURN_RATE = 12;

/** Jacket or shirt colour per role. */
const ROLE_COLORS: Record<VendorRole, number> = {
  'account-exec': 0xe0533d,
  'renewal-rep': 0x8e6cd8,
  'license-auditor': 0x7d8a99,
  'support-agent': 0x3fb58a,
  'solutions-architect': 0xe0a33d,
};
/** Trousers per role: navy, charcoal, khaki. */
const LEG_COLORS: Record<VendorRole, number> = {
  'account-exec': 0x23304a,
  'renewal-rep': 0x2f2f36,
  'license-auditor': 0x3a3f47,
  'support-agent': 0x8a7a5a,
  'solutions-architect': 0x2a3a4a,
};
/** Stylised head tones: flat, cartoon, nobody in particular. */
const HEAD_COLORS = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69, 0xffdbac] as const;

/** A box geometry with one vertex colour, moved by (x, y, z). */
function coloured(
  geo: THREE.BufferGeometry,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Merging needs the same attributes everywhere.
  g.deleteAttribute('uv');
  return g;
}

const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) =>
  coloured(new THREE.BoxGeometry(w, h, d), color, x, y, z);

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  return g;
}

/** Local space: +z is the vendor's front, y up, feet at 0. Props sit at hand height. */
function propGeometry(role: VendorRole): THREE.BufferGeometry {
  switch (role) {
    case 'license-auditor':
      // A clipboard with a sheet.
      return merge([
        box(0.24, 0.32, 0.02, 0x8b5a2b, 0.18, 1.1, 0.2),
        box(0.2, 0.26, 0.01, 0xf4f4f0, 0.18, 1.08, 0.215),
        box(0.08, 0.03, 0.03, 0xb0b0b0, 0.18, 1.25, 0.21),
      ]);
    case 'renewal-rep':
      // An open laptop, held flat.
      return merge([
        box(0.34, 0.02, 0.24, 0x3a3d44, 0, 1.0, 0.3),
        box(0.34, 0.22, 0.02, 0x3a3d44, 0, 1.11, 0.42),
        box(0.3, 0.18, 0.005, 0x7fd1ff, 0, 1.11, 0.41),
      ]);
    case 'account-exec':
      // A tablet, held up to show you something.
      return merge([
        box(0.22, 0.3, 0.02, 0x1d1f24, 0.12, 1.25, 0.28),
        box(0.19, 0.26, 0.005, 0x9be564, 0.12, 1.25, 0.292),
      ]);
    case 'solutions-architect':
      // A slide-deck easel, carried beside the body.
      return merge([
        box(0.03, 1.2, 0.03, 0x8b5a2b, 0.42, 0.6, 0.0),
        box(0.03, 1.2, 0.03, 0x8b5a2b, 0.62, 0.6, 0.0),
        box(0.42, 0.32, 0.02, 0xffffff, 0.52, 1.25, 0.03),
        box(0.3, 0.04, 0.01, 0xe15554, 0.52, 1.32, 0.045),
        box(0.2, 0.04, 0.01, 0x4d9de0, 0.52, 1.24, 0.045),
        box(0.25, 0.04, 0.01, 0x3ddc97, 0.52, 1.16, 0.045),
      ]);
    case 'support-agent':
      // A headset: a band over the head, ear cups and a boom mic.
      return merge([
        box(0.34, 0.03, 0.05, 0x222222, 0, 1.83, 0),
        box(0.05, 0.1, 0.08, 0x222222, -0.16, 1.68, 0),
        box(0.05, 0.1, 0.08, 0x222222, 0.16, 1.68, 0),
        box(0.02, 0.02, 0.16, 0x222222, 0.15, 1.6, 0.08),
        box(0.04, 0.04, 0.04, 0xe15554, 0.15, 1.6, 0.17),
      ]);
  }
}

function tagTexture(text: string, color: number): THREE.CanvasTexture {
  return canvasTexture(256, 56, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(10, 16, 26, 0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 8, h);
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2 + 4, h / 2 + 1);
  });
}

function dollarTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#3ddc97';
    ctx.strokeStyle = '#0b3d22';
    ctx.lineWidth = 6;
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('$', w / 2, h / 2 + 2);
    ctx.fillText('$', w / 2, h / 2 + 2);
  });
}

export function createVendorLayer(scene: THREE.Scene): VendorLayer {
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

  const plain = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
  const legGeo = new THREE.BoxGeometry(0.34, 0.86, 0.2);
  legGeo.translate(0, 0.43, 0);
  const legs = instanced(legGeo, plain(), MAX);
  const torsoGeo = new THREE.BoxGeometry(0.46, 0.62, 0.26);
  torsoGeo.translate(0, 0.31, 0);
  const torso = instanced(torsoGeo, plain(), MAX);
  const headGeo = new THREE.IcosahedronGeometry(0.14, 1);
  headGeo.translate(0, 0.17, 0);
  const heads = instanced(headGeo, new THREE.MeshLambertMaterial({ flatShading: true }), MAX);
  // Lanyard and badge, worn on the front of the torso (local to the torso).
  const lanyard = instanced(
    merge([
      box(0.03, 0.3, 0.01, 0x4d9de0, -0.07, 0.45, 0.135),
      box(0.03, 0.3, 0.01, 0x4d9de0, 0.07, 0.45, 0.135),
      box(0.12, 0.14, 0.012, 0xf4f4f0, 0, 0.26, 0.14),
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    MAX,
  );
  const props = new Map<VendorRole, THREE.InstancedMesh>();
  for (const r of ROLES) {
    props.set(
      r,
      instanced(propGeometry(r), new THREE.MeshLambertMaterial({ vertexColors: true }), MAX),
    );
  }
  const tagGeo = new THREE.PlaneGeometry(0.56, 0.123);
  const tags = new Map<VendorRole, THREE.InstancedMesh>();
  for (const r of ROLES) {
    const mat = new THREE.MeshBasicMaterial({
      map: own(tagTexture(VENDOR_ROLES[r].title, ROLE_COLORS[r])),
      transparent: true,
      depthWrite: false,
    });
    tags.set(r, instanced(tagGeo.clone(), mat, MAX));
  }
  tagGeo.dispose();
  const dollars = instanced(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({
      map: own(dollarTexture()),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    MAX * DOLLARS_EACH,
  );

  // Per-instance colours, set once: they never change for a given slot's role.
  const tmpColor = new THREE.Color();
  for (const m of [legs, torso, heads]) m.setColorAt(0, tmpColor.set(0xffffff));

  const prevX = new Float64Array(MAX);
  const prevZ = new Float64Array(MAX);
  const yaws = new Float64Array(MAX);
  let known = 0;
  /** Vendors that have a facing yet; a new one faces the player at once. */
  let turned = 0;
  let lastAnim = 0;

  const root = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const counts = new Map<THREE.InstancedMesh, number>();

  const put = (mesh: THREE.InstancedMesh, m: THREE.Matrix4) => {
    const i = counts.get(mesh) ?? 0;
    if (i >= mesh.instanceMatrix.count) return -1;
    mesh.setMatrixAt(i, m);
    counts.set(mesh, i + 1);
    return i;
  };

  return {
    capture(s) {
      const n = Math.min(MAX, s.vendors.length);
      for (let i = 0; i < n; i++) {
        const v = s.vendors[i];
        if (!v) continue;
        prevX[i] = v.x;
        prevZ[i] = v.z;
      }
      // New vendors start where they stand: no slide in from the origin.
      known = n;
    },
    reset() {
      known = 0;
      turned = 0;
      yaws.fill(0);
    },
    update(s, alpha, animTime, camera) {
      counts.clear();
      const n = Math.min(MAX, s.vendors.length);
      const camQ = camera.quaternion;
      // A turn rate per second, not per frame: the same at 60 Hz and 120 Hz.
      const turn = 1 - Math.exp(-TURN_RATE * Math.max(0, animTime - lastAnim));
      lastAnim = animTime;
      for (let i = 0; i < n; i++) {
        const v = s.vendors[i];
        if (!v) continue;
        if (i >= known) {
          prevX[i] = v.x;
          prevZ[i] = v.z;
        }
        const x = (prevX[i] ?? v.x) + (v.x - (prevX[i] ?? v.x)) * alpha;
        const z = (prevZ[i] ?? v.z) + (v.z - (prevZ[i] ?? v.z)) * alpha;
        const distracted = s.time < v.distractedUntil;
        // Face the player, turning smoothly.
        const want = Math.atan2(s.player.x - x, s.player.z - z);
        let d = want - (yaws[i] ?? 0);
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaws[i] = i >= turned ? want : (yaws[i] ?? 0) + d * turn;
        const phase = animTime * 9 + v.id * 1.7;
        const bob = v.walking && !distracted ? Math.abs(Math.sin(phase)) * 0.05 : 0;
        q.setFromAxisAngle(yAxis, yaws[i] ?? 0);
        pos.set(x, bob, z);
        root.compose(pos, q, one);

        // Legs: squat when gathering bills.
        scl.set(1, distracted ? 0.5 : 1, 1);
        local.compose(pos.set(0, 0, 0), qTilt.identity(), scl);
        const li = put(legs, out.multiplyMatrices(root, local));
        const hip = distracted ? 0.43 : 0.86;
        // Torso: leans forward to pick up money.
        qTilt.setFromAxisAngle(xAxis, distracted ? 0.6 : Math.sin(phase) * 0.03);
        local.compose(pos.set(0, hip, 0), qTilt, one);
        const torsoM = out.multiplyMatrices(root, local);
        const ti = put(torso, torsoM);
        put(lanyard, torsoM);
        local.compose(pos.set(0, 0.62, 0), q.identity(), one);
        put(heads, out.multiplyMatrices(torsoM, local));
        // The prop: held while standing, set down beside the vendor when distracted.
        local.compose(pos.set(0, distracted ? -0.45 : 0, 0), q.identity(), one);
        const prop = props.get(v.role);
        if (prop) put(prop, out.multiplyMatrices(root, local));
        const hi = (counts.get(heads) ?? 1) - 1;
        if (li >= 0) legs.setColorAt(li, tmpColor.set(LEG_COLORS[v.role]));
        if (ti >= 0) torso.setColorAt(ti, tmpColor.set(ROLE_COLORS[v.role]));
        if (hi >= 0)
          heads.setColorAt(hi, tmpColor.set(HEAD_COLORS[v.id % HEAD_COLORS.length] ?? 0));

        // Role tag over the head, facing the camera.
        const near = Math.hypot(x - s.player.x, z - s.player.z) <= TAG_RANGE;
        const tag = tags.get(v.role);
        if (near && tag) {
          pos.set(x, (distracted ? 1.55 : 2.08) + bob, z);
          out.compose(pos, camQ, one);
          put(tag, out);
        }
        if (distracted) {
          for (let k = 0; k < DOLLARS_EACH; k++) {
            const t = (animTime * 0.8 + k / DOLLARS_EACH + v.id * 0.13) % 1;
            const a = phase * 0.3 + (k * Math.PI * 2) / DOLLARS_EACH;
            pos.set(x + Math.cos(a) * 0.3, 1.2 + t * 0.7, z + Math.sin(a) * 0.3);
            scl.setScalar(1 - t * 0.6);
            out.compose(pos, camQ, scl);
            put(dollars, out);
          }
        }
      }
      turned = n;
      for (const m of meshes) {
        m.count = counts.get(m) ?? 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      for (const m of meshes) {
        scene.remove(m);
        m.dispose();
      }
      for (const d of disposables) d.dispose();
    },
  };
}
