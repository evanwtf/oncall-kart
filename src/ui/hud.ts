import { DRIVERS } from '../logic/drivers';
import type { ItemKind } from '../logic/items';
import { STEP_COLORS } from '../logic/ops';
import { standings, type Race, type RaceEvent } from '../logic/race';
import { nextStep } from '../logic/ticket';
import { forwardDelta, type Track } from '../logic/track';

/** 1st, 2nd, 3rd, 4th ... */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export const ITEM_LABELS: Record<ItemKind, { icon: string; name: string }> = {
  coffee: { icon: '☕', name: 'COFFEE' },
  rollback: { icon: '↺', name: 'ROLLBACK' },
  firewall: { icon: '⬢', name: 'FIREWALL' },
  page: { icon: '📟', name: 'PAGE' },
  spill: { icon: '💧', name: 'SPILL' },
};

const driverName = (race: Race, id: number | null) =>
  id === null ? '' : (DRIVERS[race.karts[id]?.driverIndex ?? -1]?.name ?? 'someone');

/**
 * The toast for a hit event, from the player's side: hits on the player, and
 * the player's Pages and puddles that hit someone. null: no toast.
 */
export function hitToast(
  e: Extract<RaceEvent, { type: 'hit' }>,
  race: Race,
): { text: string; kind: string } | null {
  const me = race.playerId;
  if (e.kartId !== me) {
    if (e.byId !== me || e.outcome !== 'spun') return null;
    const who = driverName(race, e.kartId).toUpperCase();
    return { text: e.kind === 'page' ? `YOU PAGED ${who}` : `${who} SLIPPED`, kind: 'good small' };
  }
  if (e.outcome === 'blocked') return { text: 'FIREWALL HELD', kind: 'good' };
  if (e.outcome === 'rolled-back') return { text: 'ROLLED BACK', kind: 'good' };
  if (e.outcome !== 'spun') return null;
  const by = driverName(race, e.byId).toUpperCase();
  switch (e.kind) {
    case 'page':
      return { text: `PAGED BY ${by}`, kind: 'bad' };
    case 'spill':
      return { text: e.byId === me ? 'YOUR OWN COFFEE' : `${by}'S COFFEE`, kind: 'bad' };
    case 'cable':
      return { text: 'CABLE SPAGHETTI', kind: 'bad' };
    case 'cron':
      return { text: 'ROGUE CRON JOB', kind: 'bad' };
    case 'wrong-gate':
      // The wrong-gate event has its own toast.
      return null;
  }
}

/** A tag above a kart: its screen position and distance, or null when off screen. */
export type TagPos = { x: number; y: number; dist: number } | null;

/** Tags shown at most, nearest first. */
export const MAX_TAGS = 3;
/** Only karts this close along the track (m) get a tag: none across the hall. */
export const TAG_TRACK_RANGE = 40;

/**
 * The name tags to show: none in the countdown or the first second (the GO
 * text owns the middle); only rivals near the player along the track; the
 * nearest MAX_TAGS first; and none whose box overlaps a nearer tag. size(id)
 * gives a tag's width and height in px. The tag's box is centered on x and
 * ends at y.
 */
export function pickTags(
  race: Race,
  tags: readonly TagPos[],
  size: (id: number) => { w: number; h: number },
): Array<{ id: number; x: number; y: number; alpha: number }> {
  if (race.phase === 'countdown' || race.time < 1) return [];
  const me = race.karts[race.playerId];
  if (!me) return [];
  const L = race.track.length;
  const near = race.karts
    .map((k) => ({ k, p: tags[k.id] }))
    .filter(
      ({ k, p }) =>
        p != null &&
        k.id !== race.playerId &&
        Math.abs(forwardDelta(me.proj.s, k.proj.s, L)) < TAG_TRACK_RANGE,
    )
    .sort((a, b) => (a.p?.dist ?? 0) - (b.p?.dist ?? 0));
  const placed: Array<{ id: number; x: number; y: number; alpha: number; w: number; h: number }> =
    [];
  for (const { k, p } of near) {
    if (!p || placed.length >= MAX_TAGS) break;
    const { w, h } = size(k.id);
    const hits = placed.some(
      (o) => Math.abs(o.x - p.x) < (o.w + w) / 2 && Math.abs(o.y - p.y) < (o.h + h) / 2,
    );
    if (hits) continue;
    // Fade out between 25 m and 60 m from the camera.
    const alpha = Math.max(0, Math.min(1, (60 - p.dist) / 35));
    if (alpha > 0) placed.push({ id: k.id, x: p.x, y: p.y, alpha, w, h });
  }
  return placed.map(({ id, x, y, alpha }) => ({ id, x, y, alpha }));
}

/** Draws the track outline once, then the karts as dots each frame. */
function createMinimap(canvas: HTMLCanvasElement) {
  let key: Track | null = null;
  let outline: HTMLCanvasElement | null = null;
  let toPx = (x: number, z: number): [number, number] => [x, z];
  const size = canvas.width;

  const build = (track: Track) => {
    const pts = Array.from({ length: 200 }, (_, i) => track.pointAt((i / 200) * track.length));
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const pad = 10;
    const k = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * k) / 2;
    const oz = (size - (maxZ - minZ) * k) / 2;
    // North (+z) is up; east (+x) is left, as the chase camera sees it facing north.
    toPx = (x, z) => [size - (ox + (x - minX) * k), size - (oz + (z - minZ) * k)];
    outline = document.createElement('canvas');
    outline.width = size;
    outline.height = size;
    const c = outline.getContext('2d');
    if (!c) return;
    c.lineJoin = 'round';
    c.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = toPx(p.x, p.z);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath();
    c.strokeStyle = 'rgba(230, 237, 243, 0.35)';
    c.lineWidth = 7;
    c.stroke();
    // The finish line.
    const [fx, fy] = toPx(pts[0]?.x ?? 0, pts[0]?.z ?? 0);
    c.fillStyle = '#e8eef5';
    c.fillRect(fx - 5, fy - 1.5, 10, 3);
  };

  return (race: Race) => {
    if (race.track !== key) {
      key = race.track;
      build(race.track);
    }
    const c = canvas.getContext('2d');
    if (!c || !outline) return;
    c.clearRect(0, 0, size, size);
    c.drawImage(outline, 0, 0);
    // The player last, so it draws on top.
    const order = [...race.karts].sort(
      (a, b) => Number(a.id === race.playerId) - Number(b.id === race.playerId),
    );
    for (const k of order) {
      const [x, y] = toPx(k.kart.pos.x, k.kart.pos.z);
      const me = k.id === race.playerId;
      c.beginPath();
      c.arc(x, y, me ? 6 : 4, 0, Math.PI * 2);
      c.fillStyle = `#${(DRIVERS[k.driverIndex]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
      c.fill();
      if (me) {
        c.lineWidth = 2;
        c.strokeStyle = '#ffffff';
        c.stroke();
      }
    }
  };
}

/** m:ss.t */
export function formatTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const TOAST_SECONDS = 1.6;
/** Seconds a new race place must hold before the HUD shows it. */
export const PLACE_HOLD = 0.3;

export interface Hud {
  el: HTMLElement;
  /** tags: the kart tag positions from the scene, by kart id. */
  update(race: Race, tags?: readonly TagPos[]): void;
  onEvents(events: RaceEvent[], race: Race): void;
  clear(): void;
}

function div(cls: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  parent?.appendChild(d);
  return d;
}

/** Set text only when it changes: the HUD updates every frame. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function createHud(root: HTMLElement): Hud {
  const el = div('hud', root);
  const left = div('hud-left', el);
  const lap = div('hud-lap', left);
  const time = div('hud-time', left);
  const best = div('hud-best', left);

  const card = div('ticket', el);
  const head = div('ticket-head', card);
  const steps = document.createElement('ol');
  steps.className = 'ticket-steps';
  card.appendChild(steps);
  const sla = div('sla', card);
  const slaFill = div('sla-fill', sla);
  const slaText = div('sla-text', card);

  const place = div('hud-place', el);
  const placeNum = div('place-num', place);
  const placeOf = div('place-of', place);
  const itemSlot = div('hud-item', el);
  const itemIcon = div('item-icon', itemSlot);
  const itemName = div('item-name', itemSlot);
  const mapEl = document.createElement('canvas');
  mapEl.className = 'minimap';
  mapEl.width = 160;
  mapEl.height = 160;
  el.appendChild(mapEl);
  const drawMap = createMinimap(mapEl);
  const tagLayer = div('tags', el);
  let tagEls: HTMLElement[] = [];
  let tagSizes: Array<{ w: number; h: number }> = [];
  let lastPlace = 0;

  const speed = div('hud-speed', el);
  const toasts = div('toasts', el);
  let toastList: { el: HTMLElement; until: number }[] = [];
  let stepsKey = '';

  const toast = (text: string, kind: string, now: number) => {
    const t = div(`toast ${kind}`, toasts);
    t.textContent = text;
    toastList.push({ el: t, until: now + TOAST_SECONDS });
    while (toastList.length > 3) toastList.shift()?.el.remove();
  };

  const updateTags = (race: Race, tags: readonly TagPos[]) => {
    if (tagEls.length !== race.karts.length) {
      for (const t of tagEls) t.remove();
      tagSizes = [];
      tagEls = race.karts.map((k) => {
        const t = div('tag', tagLayer);
        t.textContent = DRIVERS[k.driverIndex]?.name ?? '';
        t.style.borderColor = `#${(DRIVERS[k.driverIndex]?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
        t.style.display = 'none';
        return t;
      });
    }
    // Each tag's size, measured once: on its first frame on screen.
    const size = (id: number) => {
      const known = tagSizes[id];
      if (known) return known;
      const t = tagEls[id];
      if (!t) return { w: 0, h: 0 };
      t.style.display = '';
      const measured = { w: t.offsetWidth, h: t.offsetHeight };
      t.style.display = 'none';
      if (measured.w > 0) tagSizes[id] = measured;
      return measured;
    };
    const shown = pickTags(race, tags, size);
    const on = new Set(shown.map((x) => x.id));
    tagEls.forEach((t, i) => {
      if (!on.has(i)) t.style.display = 'none';
    });
    for (const x of shown) {
      const t = tagEls[x.id];
      if (!t) continue;
      t.style.display = '';
      t.style.opacity = x.alpha.toFixed(2);
      t.style.transform = `translate(${x.x.toFixed(0)}px, ${x.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
  };

  /** Shown place, and the place that must hold PLACE_HOLD s before it shows. */
  let pendingPlace = 0;
  let pendingSince = 0;

  return {
    el,
    update(race, tags = []) {
      const k = race.karts[race.playerId];
      if (!k) return;
      const order = race.finalOrder ?? standings(race);
      const live = order.indexOf(k.id) + 1;
      // Hysteresis: a place shows once it has held PLACE_HOLD s, so two karts
      // side by side do not flicker the panel. The frozen results show at once.
      if (live !== pendingPlace) {
        pendingPlace = live;
        pendingSince = race.time;
      }
      const settled =
        lastPlace === 0 || race.finalOrder !== null || race.time - pendingSince >= PLACE_HOLD;
      const myPlace = settled ? pendingPlace : lastPlace;
      setText(placeNum, ordinal(myPlace));
      setText(placeOf, `/ ${race.karts.length}`);
      if (myPlace !== lastPlace) {
        if (lastPlace !== 0) {
          place.classList.remove('up', 'down');
          // Restart the animation.
          void place.offsetWidth;
          place.classList.add(myPlace < lastPlace ? 'up' : 'down');
        }
        lastPlace = myPlace;
      }
      const item = k.item === null ? null : ITEM_LABELS[k.item];
      setText(itemIcon, item?.icon ?? '·');
      setText(itemName, item?.name ?? 'NO ITEM');
      itemSlot.classList.toggle('empty', item === null);
      if (mapEl.offsetParent !== null) {
        // Under the ticket card when the card is on the right.
        const top = card.offsetTop + card.offsetHeight + 8;
        mapEl.style.setProperty('--map-top', `${top}px`);
        drawMap(race);
      }
      updateTags(race, tags);
      const shownLap = Math.min(race.config.laps, k.lap.completed + 1);
      setText(lap, `LAP ${shownLap}/${race.config.laps}`);
      setText(time, formatTime(k.finishedAt ?? race.time));
      setText(best, k.lap.bestLap === null ? 'BEST -:--.-' : `BEST ${formatTime(k.lap.bestLap)}`);
      setText(speed, `${Math.round(Math.abs(k.kart.speed) * 3.6)} km/h`);

      const t = k.ticket;
      setText(head, `#${String(t.number).padStart(4, '0')} ${t.type.title} · ${t.location}`);
      const key = `${t.number}:${t.stepIndex}`;
      if (key !== stepsKey) {
        stepsKey = key;
        steps.replaceChildren(
          ...t.type.steps.map((s, i) => {
            const li = document.createElement('li');
            const state = i < t.stepIndex ? 'done' : i === t.stepIndex ? 'next' : 'pending';
            li.className = `step ${state}`;
            const mark = document.createElement('span');
            mark.className = 'mark';
            mark.textContent = state === 'done' ? '✓' : state === 'next' ? '▶' : '·';
            const name = document.createElement('span');
            name.className = 'op';
            name.textContent = s;
            // The next step wears its gate color, so the player knows what to look for.
            if (state === 'next') name.style.background = STEP_COLORS[s];
            li.append(mark, name);
            if (s === 'PIT') {
              const work = document.createElement('span');
              work.className = 'work';
              work.textContent = t.type.pitWork ?? 'hands-on work';
              li.append(work);
            }
            return li;
          }),
        );
      }
      const total = t.deadline - t.issuedAt;
      const left = Math.max(0, t.deadline - race.time);
      const share = total > 0 ? left / total : 0;
      slaFill.style.transform = `scaleX(${share.toFixed(3)})`;
      sla.classList.toggle('low', share < 0.2);
      const want = nextStep(t);
      setText(slaText, want === null ? '' : `SLA ${Math.ceil(left)} s`);

      const now = race.time;
      toastList = toastList.filter((x) => {
        if (x.until > now) return true;
        x.el.remove();
        return false;
      });
    },
    onEvents(events, race) {
      const now = race.time;
      for (const e of events) {
        if (e.type === 'hit' || ('kartId' in e && e.kartId !== race.playerId)) continue;
        if (e.type === 'wrong-gate') toast('NOT IN THE RUNBOOK', 'bad', now);
        if (e.type === 'ticket-closed') toast('TICKET CLOSED: BOOST', 'good', now);
        if (e.type === 'sla-breach') toast('PAGED: SLA BREACH', 'bad', now);
        if (e.type === 'pit-service') toast(`PIT: ${e.work.toUpperCase()}`, 'info', now);
        if (e.type === 'step-ok') toast(`${e.step} ✓`, 'good small', now);
        if (e.type === 'lap' && e.completed < race.config.laps) {
          toast(
            e.completed === race.config.laps - 1 ? 'FINAL LAP' : `LAP ${formatTime(e.lapTime)}`,
            'info',
            now,
          );
        }
        if (e.type === 'respawn') toast('RESPAWN', 'info small', now);
      }
      for (const e of events) {
        if (e.type !== 'hit') continue;
        const t = hitToast(e, race);
        if (t) toast(t.text, t.kind, now);
      }
    },
    clear() {
      for (const t of toastList) t.el.remove();
      toastList = [];
      stepsKey = '';
      lastPlace = 0;
      pendingPlace = 0;
      pendingSince = 0;
      place.classList.remove('up', 'down');
      for (const t of tagEls) t.remove();
      tagEls = [];
    },
  };
}
