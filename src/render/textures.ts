import * as THREE from 'three';

/** Draw on a canvas and wrap it as a texture. */
export function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Diagonal hazard stripes, for kerbs and the dock. */
export function hazardTexture(a = '#f2c14e', b = '#1b1f24'): THREE.CanvasTexture {
  const tex = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = a;
    for (let i = -2; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 32, 0);
      ctx.lineTo(i * 32 + 16, 0);
      ctx.lineTo(i * 32 + 16 + 64, h);
      ctx.lineTo(i * 32 + 64, h);
      ctx.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Raised floor tiles: grey-blue squares with dark seams and a few vent tiles. */
export function floorTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const n = 4;
    const t = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const vent = (i * 7 + j * 3) % 11 === 0;
        ctx.fillStyle = vent ? '#2b3a4a' : (i + j) % 2 ? '#3a4656' : '#36414f';
        ctx.fillRect(i * t, j * t, t, t);
        if (vent) {
          ctx.fillStyle = '#1c2632';
          for (let k = 6; k < t - 6; k += 6) ctx.fillRect(i * t + 6, j * t + k, t - 12, 2);
        }
      }
    }
    ctx.strokeStyle = '#1a212b';
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * t, 0);
      ctx.lineTo(i * t, h);
      ctx.moveTo(0, i * t);
      ctx.lineTo(w, i * t);
      ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
