import * as THREE from 'three';
import type { Board } from '../logic/board';
import { STEP_COLORS, type Op } from '../logic/ops';
import type { Track } from '../logic/track';

interface SlotView {
  canvas: HTMLCanvasElement;
  op: Op;
  texture: THREE.CanvasTexture;
  beam: THREE.MeshBasicMaterial;
}

export interface GatesHandle {
  group: THREE.Group;
  /** Redraw the labels of one row from the board. */
  redrawRow(board: Board, row: number): void;
  /** Redraw every slot whose drawn op differs from the board. A safety net. */
  sync(board: Board): void;
  dispose(): void;
}

const HEIGHT = 3.4;

/** The label canvas, in pixels. The plane keeps the same 8:3 shape. */
const LABEL_W = 512;
const LABEL_H = 192;
/** Label width in metres: wider than a 3-gate arch, so it reads from 50 m. */
const LABEL_METRES = 5.4;

function drawLabel(canvas: HTMLCanvasElement, op: Op): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = STEP_COLORS[op];
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = '#0d1117';
  // Tall letters read farther than wide ones: squeeze long words sideways
  // (down to 62%) before making them smaller.
  let size = 140;
  const font = (px: number) =>
    `900 ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.font = font(size);
  const room = w - 36;
  while (ctx.measureText(op).width * 0.62 > room && size > 40) {
    size -= 4;
    ctx.font = font(size);
  }
  const squeeze = Math.min(1, room / ctx.measureText(op).width);
  ctx.save();
  ctx.translate(w / 2, h / 2 + size * 0.04);
  ctx.scale(squeeze, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(op, 0, 0);
  ctx.restore();
}

export function buildGates(track: Track, board: Board): GatesHandle {
  const group = new THREE.Group();
  const views: SlotView[][] = [];
  const disposables: { dispose(): void }[] = [];
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x9aa7b6,
    metalness: 0.5,
    roughness: 0.4,
  });
  disposables.push(postMat);

  board.forEach((row) => {
    const c = track.pointAt(row.s);
    const t = track.tangentAt(row.s);
    const rowGroup = new THREE.Group();
    rowGroup.position.set(c.x, 0, c.z);
    rowGroup.rotation.y = Math.atan2(t.x, t.z); // local +x is left of travel
    const rowViews: SlotView[] = [];
    for (const slot of row.slots) {
      const w = slot.halfWidth * 2;
      const postGeo = new THREE.BoxGeometry(0.3, HEIGHT, 0.3);
      const beamGeo = new THREE.BoxGeometry(w + 0.3, 0.9, 0.35);
      disposables.push(postGeo, beamGeo);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(slot.lateral + side * slot.halfWidth, HEIGHT / 2, 0);
        rowGroup.add(post);
      }
      // Unlit, so the hue stays true under the hall lights.
      const beamMat = new THREE.MeshBasicMaterial({ color: STEP_COLORS[slot.op] });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(slot.lateral, HEIGHT, 0);
      rowGroup.add(beam);

      const canvas = document.createElement('canvas');
      canvas.width = LABEL_W;
      canvas.height = LABEL_H;
      drawLabel(canvas, slot.op);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const lw = Math.max(w, LABEL_METRES);
      const lh = (lw * LABEL_H) / LABEL_W;
      const labelGeo = new THREE.PlaneGeometry(lw, lh);
      const labelMat = new THREE.MeshBasicMaterial({ map: texture });
      disposables.push(texture, labelGeo, labelMat, beamMat);
      // One-sided, facing the approaching kart (local -z): a row on another
      // part of the track cannot be read across the infield.
      const label = new THREE.Mesh(labelGeo, labelMat);
      label.position.set(slot.lateral, HEIGHT + 0.45 + lh / 2, -0.2);
      label.rotation.y = Math.PI;
      rowGroup.add(label);
      rowViews.push({ canvas, op: slot.op, texture, beam: beamMat });
    }
    views.push(rowViews);
    group.add(rowGroup);
  });

  return {
    group,
    redrawRow(b: Board, row: number) {
      const slots = b[row]?.slots ?? [];
      slots.forEach((slot, i) => {
        const v = views[row]?.[i];
        if (!v) return;
        drawLabel(v.canvas, slot.op);
        v.op = slot.op;
        v.texture.needsUpdate = true;
        v.beam.color.set(STEP_COLORS[slot.op]);
      });
    },
    sync(b: Board) {
      b.forEach((row, ri) => {
        if (row.slots.some((slot, i) => views[ri]?.[i]?.op !== slot.op)) this.redrawRow(b, ri);
      });
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
