import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, floorTexture, hazardTexture } from '../../render/textures';
import { areaAt, type FloorDef, type Target } from '../logic/floor';
import type { Shift } from '../logic/shift';
import { SHOOTER_TUNING } from '../logic/tuning';

export interface ShooterScene {
  readonly renderer: THREE.WebGLRenderer;
  /** Keep the player pose before a fixed step, for interpolation. */
  capture(s: Shift): void;
  /** A new shift: drop beacons and flashes. */
  reset(s: Shift): void;
  /** A rack's ticket closed: its beacon shows green for a moment. */
  flashGreen(rackId: string): void;
  /** `view`: the live yaw and pitch from the input, newer than the last logic step. */
  render(s: Shift, alpha: number, paused: boolean, view?: { yaw: number; pitch: number }): void;
  dispose(): void;
}

const FOG = 0x0a1420;
const WALL_HEIGHT = 3.6;
const RACK_HEIGHT = 2.1;
const SWITCH_HEIGHT = 2.1;
const FIREWALL_HEIGHT = 1.5;
/** A beacon stays green this long after its ticket closes. */
const GREEN_TIME = 1.5;
/** Most beacons drawn at once: more broken racks than this are rare. */
const MAX_BEACONS = 24;
const MAX_MARKERS = 8;

/** The front of one rack: doors, vents and LEDs. The LEDs also go in an emissive map. */
function rackFront(leds: boolean): THREE.CanvasTexture {
  return canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = leds ? '#000000' : '#10161d';
    ctx.fillRect(0, 0, w, h);
    if (!leds) {
      ctx.fillStyle = '#1a222c';
      ctx.fillRect(3, 4, w - 6, h - 8);
    }
    const colors = ['#3ddc97', '#3ddc97', '#4d9de0', '#f2a03d'];
    for (let u = 0; u < 22; u++) {
      const y = 8 + u * 11;
      if (!leds) {
        ctx.fillStyle = u % 3 ? '#222c38' : '#2a3644';
        ctx.fillRect(7, y, w - 14, 8);
      }
      if ((u * 7) % 4 !== 0) {
        ctx.fillStyle = colors[u % colors.length] ?? '#3ddc97';
        ctx.fillRect(w - 16, y + 3, 4, 2);
        if (u % 2) ctx.fillRect(w - 24, y + 3, 4, 2);
      }
    }
  });
}

/** A switch front: rows of ports with link lights. */
function switchFront(): THREE.CanvasTexture {
  return canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 10; r++) {
      const y = 12 + r * 24;
      ctx.fillStyle = '#1f3a56';
      ctx.fillRect(4, y, w - 8, 16);
      for (let p = 0; p < 6; p++) {
        ctx.fillStyle = '#05080c';
        ctx.fillRect(7 + p * 9, y + 4, 6, 6);
        ctx.fillStyle = (p + r) % 3 ? '#3ddc97' : '#f2c14e';
        ctx.fillRect(8 + p * 9, y + 12, 3, 2);
      }
    }
  });
}

/** A firewall front: a heavy grille with a warning stripe. */
function firewallFront(): THREE.CanvasTexture {
  return canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2a1414';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e15554';
    ctx.fillRect(0, 20, w, 14);
    ctx.strokeStyle = '#4a2222';
    ctx.lineWidth = 3;
    for (let y = 48; y < h - 8; y += 10) {
      ctx.beginPath();
      ctx.moveTo(6, y);
      ctx.lineTo(w - 6, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#f2a03d';
    ctx.fillRect(w - 14, 8, 6, 6);
  });
}

/** A hanging sign with the area name. */
function signTexture(text: string): THREE.CanvasTexture {
  return canvasTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#0e2238';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7fd1ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), w / 2, h / 2 + 2);
  });
}

/** One instanced box per target: the front face (+z in local space) gets its own material. */
function targetMesh(
  targets: readonly Target[],
  height: number,
  width: number,
  depth: number,
  front: THREE.Material,
  body: THREE.Material,
): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(width, height, depth);
  geo.translate(0, height / 2, 0);
  // Box faces: +x, -x, +y, -y, +z, -z.
  const mesh = new THREE.InstancedMesh(geo, [body, body, body, body, front, body], targets.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  targets.forEach((t, i) => {
    // Local +z turns to (fx, fz).
    q.setFromAxisAngle(up, Math.atan2(t.fx, t.fz));
    m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new THREE.Color(0xffffff));
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Walls and furniture, merged into one mesh. Thin boxes are walls; the rest stand lower. */
function staticBoxes(floor: FloorDef): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (const b of floor.walls) {
    const thin = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) <= 0.31;
    const area = areaAt(floor, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
    const h = thin ? WALL_HEIGHT : area === 'Loading dock' ? 1.3 : 0.9;
    const g = new THREE.BoxGeometry(b.maxX - b.minX, h, b.maxZ - b.minZ);
    g.translate((b.minX + b.maxX) / 2, h / 2, (b.minZ + b.maxZ) / 2);
    // Vertex colors: walls grey-blue, furniture warm.
    const color = new THREE.Color(thin ? 0x3b4a5e : area === 'Loading dock' ? 0x8a6a3a : 0x5a6f88);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos) ?? new THREE.BufferGeometry();
  for (const g of geos) g.dispose();
  return new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

export function createShooterScene(canvas: HTMLCanvasElement, floor: FloorDef): ShooterScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, 18, 70);
  // Cold-aisle light: blue from above, a dark floor bounce, one cool key light.
  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x2a3446, 2.6));
  const key = new THREE.DirectionalLight(0xdfeaff, 1.4);
  key.position.set(-30, 40, 20);
  scene.add(key);

  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // The floor: raised tiles, 0.6 m each (4 per texture repeat).
  const tiles = own(floorTexture());
  tiles.repeat.set(floor.width / 2.4, floor.depth / 2.4);
  const ground = new THREE.Mesh(
    own(new THREE.PlaneGeometry(floor.width, floor.depth)),
    own(new THREE.MeshLambertMaterial({ map: tiles })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(floor.width / 2, 0, floor.depth / 2);
  scene.add(ground);

  // The dock floor: hazard stripes where vendors will come in.
  const dockArea = floor.areas.find((a) => a.name === 'Loading dock')?.box;
  if (dockArea) {
    const stripes = own(hazardTexture());
    stripes.repeat.set(8, 1);
    const strip = new THREE.Mesh(
      own(new THREE.PlaneGeometry(1.2, 6)),
      own(new THREE.MeshLambertMaterial({ map: stripes })),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(dockArea.maxX - 1, 0.01, floor.dock.z);
    scene.add(strip);
  }

  // The ceiling, with light strips over the aisles.
  const ceiling = new THREE.Mesh(
    own(new THREE.PlaneGeometry(floor.width, floor.depth)),
    own(new THREE.MeshBasicMaterial({ color: 0x0c131c })),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(floor.width / 2, WALL_HEIGHT, floor.depth / 2);
  scene.add(ceiling);
  const lightGeo = own(new THREE.BoxGeometry(0.25, 0.05, 6));
  const lightSpots: { x: number; z: number }[] = [];
  for (let x = 4; x < floor.width; x += 8) {
    for (const z of [2, 7.2, 12.6, 18, 23.4, 28.8, 34]) lightSpots.push({ x, z });
  }
  const lights = new THREE.InstancedMesh(
    lightGeo,
    own(new THREE.MeshBasicMaterial({ color: 0xcfe6ff })),
    lightSpots.length,
  );
  const m4 = new THREE.Matrix4();
  lightSpots.forEach((p, i) => {
    m4.makeRotationY(Math.PI / 2);
    m4.setPosition(p.x, WALL_HEIGHT - 0.03, p.z);
    lights.setMatrixAt(i, m4);
  });
  scene.add(lights);

  const walls = staticBoxes(floor);
  own(walls.geometry);
  own(walls.material as THREE.Material);
  scene.add(walls);

  // Racks: one instanced mesh. The front carries the LEDs as an emissive map.
  const rackBody = own(new THREE.MeshLambertMaterial({ color: 0x1b232d }));
  const rackFrontMat = own(
    new THREE.MeshLambertMaterial({
      map: own(rackFront(false)),
      emissive: 0xffffff,
      emissiveMap: own(rackFront(true)),
      emissiveIntensity: 1,
    }),
  );
  const racks = targetMesh(floor.racks, RACK_HEIGHT, 0.6, 1.2, rackFrontMat, rackBody);
  own(racks.geometry);
  scene.add(racks);
  const rackIndex = new Map(floor.racks.map((r, i) => [r.id, i]));

  const switches = floor.devices.filter((d) => d.kind === 'switch');
  const firewalls = floor.devices.filter((d) => d.kind === 'firewall');
  const deviceBody = own(new THREE.MeshLambertMaterial({ color: 0x24303e }));
  if (switches.length > 0) {
    const mat = own(new THREE.MeshLambertMaterial({ map: own(switchFront()) }));
    const mesh = targetMesh(switches, SWITCH_HEIGHT, 0.8, 1.2, mat, deviceBody);
    own(mesh.geometry);
    scene.add(mesh);
  }
  if (firewalls.length > 0) {
    const mat = own(new THREE.MeshLambertMaterial({ map: own(firewallFront()) }));
    const mesh = targetMesh(firewalls, FIREWALL_HEIGHT, 1.0, 1.2, mat, deviceBody);
    own(mesh.geometry);
    scene.add(mesh);
  }

  // Area signs over the corridor, one at each doorway, read from outside the area.
  // Front side only, so no sign shows mirrored text from behind.
  const signGeo = own(new THREE.PlaneGeometry(3.2, 0.6));
  for (const a of floor.areas) {
    const mat = own(new THREE.MeshBasicMaterial({ map: own(signTexture(a.name)), fog: false }));
    const doors: { x: number; ry: number }[] = [];
    // Facing west (-x), seen from the area before it; facing east, from the area after it.
    if (a.box.minX > 0) doors.push({ x: a.box.minX - 0.2, ry: -Math.PI / 2 });
    if (a.box.maxX < floor.width) doors.push({ x: a.box.maxX + 0.2, ry: Math.PI / 2 });
    for (const d of doors) {
      const sign = new THREE.Mesh(signGeo, mat);
      sign.position.set(d.x, 3.0, floor.spawn.z);
      sign.rotation.y = d.ry;
      scene.add(sign);
    }
  }

  // Beacons: a red lamp and a beam over each broken rack. Instanced, so many cost two draws.
  const lampGeo = own(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 10));
  lampGeo.translate(0, RACK_HEIGHT + 0.11, 0);
  const lamps = new THREE.InstancedMesh(
    lampGeo,
    own(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })),
    MAX_BEACONS,
  );
  const beamGeo = own(
    new THREE.CylinderGeometry(0.08, 0.35, WALL_HEIGHT - RACK_HEIGHT, 10, 1, true),
  );
  beamGeo.translate(0, RACK_HEIGHT + (WALL_HEIGHT - RACK_HEIGHT) / 2, 0);
  const beams = new THREE.InstancedMesh(
    beamGeo,
    own(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ),
    MAX_BEACONS,
  );
  for (const mesh of [lamps, beams]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    scene.add(mesh);
  }

  // Patch markers: a blue diamond turning over each unapplied patch target.
  const markerGeo = own(new THREE.OctahedronGeometry(0.22));
  const markers = new THREE.InstancedMesh(
    markerGeo,
    own(new THREE.MeshBasicMaterial({ color: 0x4d9de0, fog: false })),
    MAX_MARKERS,
  );
  markers.count = 0;
  markers.frustumCulled = false;
  scene.add(markers);

  const targetById = new Map([...floor.racks, ...floor.devices].map((t) => [t.id, t]));
  const heightOf = (t: Target) =>
    t.kind === 'rack' ? RACK_HEIGHT : t.kind === 'switch' ? SWITCH_HEIGHT : FIREWALL_HEIGHT;

  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 120);
  camera.rotation.order = 'YXZ';

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  // A window moved to another display changes the pixel ratio but sends no resize.
  let dprQuery: MediaQueryList | null = null;
  const onDpr = () => {
    renderer.setPixelRatio(pixelRatio());
    resize();
    watchDpr();
  };
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    dprQuery?.addEventListener('change', onDpr);
  };
  watchDpr();

  let prev = { x: floor.spawn.x, z: floor.spawn.z };
  /** Rack id -> animation time its green flash ends. */
  let greens = new Map<string, number>();
  /** Rack instances tinted red last frame. */
  let tinted: number[] = [];
  let animTime = 0;
  let lastWall = performance.now();
  const red = new THREE.Color(0xff3b3b);
  const redDim = new THREE.Color(0x7a1414);
  const green = new THREE.Color(0x3ddc97);
  const white = new THREE.Color(0xffffff);
  const brokenTint = new THREE.Color(0xff8a80);
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  const setTint = (ids: readonly number[]) => {
    for (const i of tinted) racks.setColorAt(i, white);
    for (const i of ids) racks.setColorAt(i, brokenTint);
    tinted = [...ids];
    if (racks.instanceColor) racks.instanceColor.needsUpdate = true;
  };

  return {
    renderer,
    capture(s) {
      prev = { x: s.player.x, z: s.player.z };
    },
    reset(s) {
      prev = { x: s.player.x, z: s.player.z };
      greens = new Map();
      setTint([]);
    },
    flashGreen(rackId) {
      greens.set(rackId, animTime + GREEN_TIME);
    },
    render(s, alpha, paused, view) {
      const wall = performance.now();
      const dt = paused ? 0 : Math.min(0.1, (wall - lastWall) / 1000);
      lastWall = wall;
      animTime += dt;

      const a = Math.max(0, Math.min(1, alpha));
      camera.position.set(
        prev.x + (s.player.x - prev.x) * a,
        SHOOTER_TUNING.eyeHeight,
        prev.z + (s.player.z - prev.z) * a,
      );
      camera.rotation.set(view?.pitch ?? s.player.pitch, view?.yaw ?? s.player.yaw, 0);

      // Beacons: red over open tickets (blinking), green over just-closed ones.
      for (const [id, until] of greens) if (until <= animTime) greens.delete(id);
      let n = 0;
      const blinkOn = Math.floor(animTime * 2.5) % 2 === 0;
      const place = (t: Target, color: THREE.Color) => {
        if (n >= MAX_BEACONS) return;
        q.identity();
        pos.set(t.x, 0, t.z);
        m4.compose(pos, q, one);
        lamps.setMatrixAt(n, m4);
        beams.setMatrixAt(n, m4);
        lamps.setColorAt(n, color);
        beams.setColorAt(n, color);
        n++;
      };
      const broken: number[] = [];
      for (const o of s.open) {
        const t = targetById.get(o.rackId);
        if (!t) continue;
        place(t, blinkOn || o.breached ? red : redDim);
        const i = rackIndex.get(o.rackId);
        if (i !== undefined) broken.push(i);
      }
      for (const id of greens.keys()) {
        const t = targetById.get(id);
        if (t) place(t, green);
      }
      for (const mesh of [lamps, beams]) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (broken.length !== tinted.length || broken.some((v, i) => v !== tinted[i])) {
        setTint(broken);
      }

      let k = 0;
      for (const p of s.patches) {
        if (p.applied || k >= MAX_MARKERS) continue;
        const t = targetById.get(p.targetId);
        if (!t) continue;
        q.setFromAxisAngle(yAxis, animTime * 2);
        pos.set(t.x, heightOf(t) + 0.45 + Math.sin(animTime * 3) * 0.08, t.z);
        m4.compose(pos, q, one);
        markers.setMatrixAt(k++, m4);
      }
      markers.count = k;
      markers.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      dprQuery?.removeEventListener('change', onDpr);
      for (const d of disposables) d.dispose();
      racks.dispose();
      lamps.dispose();
      beams.dispose();
      markers.dispose();
      lights.dispose();
      renderer.dispose();
    },
  };
}
