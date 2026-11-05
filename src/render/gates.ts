import * as THREE from 'three';
import type { Board } from '../logic/board';
import type { Op } from '../logic/ops';
import type { Track } from '../logic/track';

/** One color per operation, so a label reads at a glance. */
export const OP_COLORS: Record<Op, string> = {
  MAINT: '#4d9de0',
  TAKEDOWN: '#e15554',
  POWERON: '#3ddc97',
  REINSTATE: '#f2c14e',
  'FW-ISO': '#b084f5',
  LOGCOLLECT: '#2ec4b6',
  'META-SYNC': '#f78fb3',
  REIMAGE: '#ff8c42',
};

interface SlotView {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  beam: THREE.MeshStandardMaterial;
}

export interface GatesHandle {
  group: THREE.Group;
  /** Redraw the labels of one row from the board. */
  redrawRow(board: Board, row: number): void;
  dispose(): void;
}

const HEIGHT = 3.4;

function drawLabel(canvas: HTMLCanvasElement, op: Op): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = OP_COLORS[op];
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillStyle = '#ffffff';
  let size = 92;
  ctx.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
  while (ctx.measureText(op).width > w - 30 && size > 30) {
    size -= 4;
    ctx.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(op, w / 2, h / 2 + 4);
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
      const beamMat = new THREE.MeshStandardMaterial({ color: OP_COLORS[slot.op], roughness: 0.5 });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(slot.lateral, HEIGHT, 0);
      rowGroup.add(beam);

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      drawLabel(canvas, slot.op);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const labelGeo = new THREE.PlaneGeometry(w, w / 4);
      const labelMat = new THREE.MeshBasicMaterial({ map: texture });
      disposables.push(texture, labelGeo, labelMat, beamMat);
      // Front faces the approaching kart (local -z); back faces away.
      for (const facing of [-1, 1]) {
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(slot.lateral, HEIGHT + 0.45 + w / 8, facing * 0.2);
        label.rotation.y = facing < 0 ? Math.PI : 0;
        rowGroup.add(label);
      }
      rowViews.push({ canvas, texture, beam: beamMat });
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
        v.texture.needsUpdate = true;
        v.beam.color.set(OP_COLORS[slot.op]);
      });
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
