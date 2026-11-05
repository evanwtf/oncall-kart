// @vitest-environment jsdom
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

  it('opens a card on a click', () => {
    const { root, open } = setup();
    root.querySelector<HTMLButtonElement>('button[data-game="shooter"]')?.click();
    expect(open).toHaveBeenCalledWith('shooter');
  });
});
