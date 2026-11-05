/** The start screen: pick the kart game or the shooter. */

export type GameId = 'kart' | 'shooter';

const GAMES: readonly GameId[] = ['kart', 'shooter'];

/** The game named by `?game=`, or null for none or an unknown value. */
export function parseGame(search: string): GameId | null {
  const g = new URLSearchParams(search).get('game');
  return GAMES.find((id) => id === g) ?? null;
}

/** The URL with `game` set, or removed for null. The path and every other param stay. */
export function gameUrl(href: string, game: GameId | null): string {
  const u = new URL(href);
  if (game === null) u.searchParams.delete('game');
  else u.searchParams.set('game', game);
  return u.toString();
}

interface Card {
  id: GameId;
  name: string;
  tagline: string;
  blurb: string;
}

const CARDS: readonly Card[] = [
  {
    id: 'kart',
    name: 'oncall-kart',
    tagline: 'The race is the queue.',
    blurb: 'Drive through the gates in runbook order. Keyboard or touch.',
  },
  {
    id: 'shooter',
    name: 'Zero Down',
    tagline: 'One shift. Zero servers down.',
    blurb: 'Walk the floor, fix what breaks, apply the patches. Mouse and keyboard.',
  },
];

/**
 * Show the two game cards. Arrows (or A/D) move the selection; Enter, a
 * click or a tap opens a game. Returns a function that removes the picker.
 */
export function showPicker(
  root: HTMLElement,
  open: (id: GameId) => void = (id) => window.location.assign(gameUrl(window.location.href, id)),
): () => void {
  const box = document.createElement('div');
  box.className = 'screen picker';
  root.dataset.screen = 'picker';
  const h1 = document.createElement('h1');
  h1.className = 'logo';
  h1.textContent = 'On call';
  box.appendChild(h1);
  const sub = document.createElement('p');
  sub.className = 'tagline';
  sub.textContent = 'Pick your shift.';
  box.appendChild(sub);

  const row = document.createElement('div');
  row.className = 'picker-cards';
  box.appendChild(row);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  let selected = 0;
  const buttons = CARDS.map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `picker-card picker-${c.id}`;
    b.dataset.game = c.id;
    b.tabIndex = -1;
    const name = document.createElement('span');
    name.className = 'picker-name';
    name.textContent = c.name;
    const tag = document.createElement('span');
    tag.className = 'picker-tagline';
    tag.textContent = c.tagline;
    const blurb = document.createElement('span');
    blurb.className = 'picker-blurb';
    blurb.textContent = c.blurb;
    b.append(name, tag, blurb);
    if (c.id === 'shooter' && coarse) {
      const note = document.createElement('span');
      note.className = 'picker-note';
      note.textContent = 'Needs a mouse and keyboard';
      b.appendChild(note);
    }
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      selected = i;
      sync();
      open(c.id);
    });
    row.appendChild(b);
    return b;
  });
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '← → to choose · Enter to start';
  box.appendChild(hint);
  const version = document.createElement('p');
  version.className = 'version';
  version.textContent = `v${__APP_VERSION__}`;
  box.appendChild(version);

  const sync = () => buttons.forEach((b, i) => b.classList.toggle('selected', i === selected));
  sync();

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') selected = 0;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') selected = CARDS.length - 1;
    else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      const c = CARDS[selected];
      if (c) open(c.id);
    } else return;
    e.preventDefault();
    sync();
  };
  window.addEventListener('keydown', onKey);
  root.appendChild(box);

  return () => {
    window.removeEventListener('keydown', onKey);
    box.remove();
  };
}
