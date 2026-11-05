// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameUrl, parseGame, showPicker } from '../src/picker';

describe('parseGame', () => {
  it('reads the game from the query', () => {
    expect(parseGame('?game=kart')).toBe('kart');
    expect(parseGame('?game=shooter&seed=1')).toBe('shooter');
    expect(parseGame('?seed=1&game=shooter')).toBe('shooter');
  });

  it('returns null for no game or an unknown game', () => {
    expect(parseGame('')).toBeNull();
    expect(parseGame('?game=nope')).toBeNull();
    expect(parseGame('?seed=1')).toBeNull();
  });
});

describe('gameUrl', () => {
  const base = 'https://x/oncall-kart/?seed=1&debug=1';

  it('adds the game and keeps the path and every other param', () => {
    const u = new URL(gameUrl(base, 'shooter'));
    expect(u.pathname).toBe('/oncall-kart/');
    expect(u.searchParams.get('seed')).toBe('1');
    expect(u.searchParams.get('debug')).toBe('1');
    expect(u.searchParams.get('game')).toBe('shooter');
  });

  it('replaces a game that is already set', () => {
    const u = new URL(gameUrl('https://x/oncall-kart/?game=kart', 'shooter'));
    expect(u.searchParams.getAll('game')).toEqual(['shooter']);
  });

  it('removes only the game for null', () => {
    const u = new URL(gameUrl('https://x/oncall-kart/?seed=1&game=kart&debug=1', null));
    expect(u.pathname).toBe('/oncall-kart/');
    expect(u.searchParams.has('game')).toBe(false);
    expect(u.searchParams.get('seed')).toBe('1');
    expect(u.searchParams.get('debug')).toBe('1');
  });
});

describe('showPicker', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.replaceChildren();
  });

  const setup = () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const open = vi.fn();
    dispose = showPicker(root, open);
    return { root, open };
  };
  const key = (code: string) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

  it('shows one card per game', () => {
    const { root } = setup();
    const cards = [...root.querySelectorAll<HTMLButtonElement>('button[data-game]')];
    expect(cards.map((c) => c.dataset.game)).toEqual(['kart', 'shooter']);
  });

  it('moves the selection with the arrows and opens it with Enter', () => {
    const { open } = setup();
    key('ArrowRight');
    key('Enter');
    expect(open).toHaveBeenCalledWith('shooter');
    key('KeyA');
    key('Enter');
    expect(open).toHaveBeenLastCalledWith('kart');
  });

  it('leaves keys with a modifier to the browser', () => {
    const { open } = setup();
    for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', [mod]: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', [mod]: true }));
    }
    expect(open).not.toHaveBeenCalled();
    // Cmd+D did not move the selection either: plain Enter opens the kart card.
    key('Enter');
    expect(open).toHaveBeenCalledWith('kart');
  });

  it('keeps the Switch game button clear of the notch and the rounded corners', () => {
    // jsdom gives import.meta.url a non-file scheme: read from the repo root.
    const css = readFileSync(resolve(process.cwd(), 'src/ui/picker.css'), 'utf8');
    const rule = /\.switch-game\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/top:\s*calc\(env\(safe-area-inset-top[^;]*\+ 12px\)/);
    expect(rule).toMatch(/left:\s*calc\(env\(safe-area-inset-left[^;]*\+ 16px\)/);
  });

  it('opens a card on a click', () => {
    const { root, open } = setup();
    root.querySelector<HTMLButtonElement>('button[data-game="shooter"]')?.click();
    expect(open).toHaveBeenCalledWith('shooter');
  });
});
