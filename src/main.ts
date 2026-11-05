import { startGame } from './game';
import { parseGame, showPicker } from './picker';
import { startShooter } from './shooter/game';
import { showNoWebGl } from './ui/screens';
import './ui/style.css';
import './ui/touch.css';
import './ui/picker.css';

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
  if (!hasWebGl2()) showNoWebGl(ui);
  else {
    const game = parseGame(window.location.search);
    if (game === 'kart') startGame(canvas, ui);
    else if (game === 'shooter') startShooter(canvas, ui);
    else showPicker(ui);
  }
}
