import { startGame } from './game';
import { showNoWebGl } from './ui/screens';
import './ui/style.css';

function hasWebGl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
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
