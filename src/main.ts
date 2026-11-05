import { startGame } from './game';
import { showNoWebGl } from './ui/screens';
import './ui/style.css';
import './ui/touch.css';

function hasWebGl2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    // Release the probe context: browsers cap how many a page may hold.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
if (canvas instanceof HTMLCanvasElement && ui) {
  if (hasWebGl2()) startGame(canvas, ui);
  else showNoWebGl(ui);
}
