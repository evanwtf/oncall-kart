/** Zero Down: the shooter. A stub until the floor, the HUD and the loop land. */
export function startShooter(_canvas: HTMLCanvasElement, ui: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'screen';
  const h1 = document.createElement('h1');
  h1.className = 'logo';
  h1.textContent = 'Zero Down';
  const p = document.createElement('p');
  p.className = 'tagline';
  p.textContent = 'Zero Down: coming in this build';
  box.append(h1, p);
  ui.appendChild(box);
}
