import { STEP_COLORS, type Step } from '../../logic/ops';
import type { FloorDef, Target } from '../logic/floor';
import { PANEL_STEPS, type Shift, type ShiftEvent } from '../logic/shift';
import { SHOOTER_TUNING } from '../logic/tuning';
import { VENDOR_ROLES, closeVendors, slowFactor } from '../logic/vendors';

/** m:ss for a number of seconds, rounded up, so 0:00 shows only at the very end. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The panel label for a step: the hands-on step shows the ticket's own work. */
export function panelLabel(step: Step, pitWork: string | undefined): string {
  return step === 'PIT' ? `Hands-on: ${pitWork ?? 'the work at the rack'}` : step;
}

/** The budget as dollars: $20,000. */
export function formatBudget(n: number): string {
  return '$' + Math.max(0, Math.round(n)).toLocaleString('en-US');
}

/** The slowdown readout for `close` vendors; empty when nobody is close. */
export function speedText(close: number): string {
  if (close <= 0) return '';
  const pct = Math.round(slowFactor(close) * 100);
  return `Speed ${pct}% · ${close} vendor${close === 1 ? '' : 's'} close`;
}

export type ToastKind = 'good' | 'bad' | 'vendor';

/** The toast for an event, or null for none. */
export function eventToast(e: ShiftEvent, s: Shift): { text: string; kind: ToastKind } | null {
  switch (e.type) {
    case 'break': {
      return { text: `${e.ticket.type.title} at ${e.ticket.location}`, kind: 'bad' };
    }
    case 'step-ok':
      return { text: `${e.step} done`, kind: 'good' };
    case 'step-wrong':
      return { text: `Wrong step: ${e.step}. The alarm is going off.`, kind: 'bad' };
    case 'ticket-closed':
      return { text: `${e.rackId} is back in service`, kind: 'good' };
    case 'patch-applied': {
      const p = s.patches.find((x) => x.id === e.patchId);
      return { text: `Patched: ${p?.name ?? e.patchId}`, kind: 'good' };
    }
    case 'sla-breach':
      return { text: `SLA breach at ${e.rackId}`, kind: 'bad' };
    case 'vendor-close':
      return { text: `${VENDOR_ROLES[e.role].title}: ${e.line}`, kind: 'vendor' };
    case 'picked-up':
      return e.kind === 'po'
        ? { text: `Approved PO: +${formatBudget(SHOOTER_TUNING.poAmount)}`, kind: 'good' }
        : { text: 'Toolkit: every step is faster', kind: 'good' };
    default:
      return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Write text only when it changes: a same-value write still churns the DOM. */
function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

function setHidden(e: HTMLElement, hidden: boolean): void {
  if (e.hidden !== hidden) e.hidden = hidden;
}

function setTransform(e: HTMLElement, value: string): void {
  if (e.style.transform !== value) e.style.transform = value;
}

/** Map scale, pixels per metre. */
const MAP_SCALE = 2.2;
const TOAST_TIME = 3;

export interface ShooterHud {
  el: HTMLElement;
  update(s: Shift, facing: Target | null): void;
  onEvents(events: readonly ShiftEvent[], s: Shift): void;
  clear(): void;
}

/** Draw the fixed parts of the floor once: walls, racks and devices. */
function drawFloorBase(floor: FloorDef, w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.scale(dpr * MAP_SCALE, dpr * MAP_SCALE);
  ctx.fillStyle = 'rgba(14, 24, 38, 0.85)';
  ctx.fillRect(0, 0, floor.width, floor.depth);
  ctx.fillStyle = '#4a5a70';
  for (const b of floor.walls) ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
  ctx.fillStyle = '#2c3a4c';
  for (const t of floor.racks) {
    ctx.fillRect(t.box.minX, t.box.minZ, t.box.maxX - t.box.minX, t.box.maxZ - t.box.minZ);
  }
  ctx.fillStyle = '#5c7896';
  for (const t of floor.devices) {
    ctx.fillRect(t.box.minX, t.box.minZ, t.box.maxX - t.box.minX, t.box.maxZ - t.box.minZ);
  }
  return c;
}

export function createShooterHud(root: HTMLElement): ShooterHud {
  const hud = el('div', 'zd-hud', undefined, root);
  hud.hidden = true;
  const clock = el('div', 'zd-clock', '3:00', hud);
  const tickets = el('div', 'zd-tickets', undefined, hud);
  const patchBox = el('div', 'zd-patches', undefined, hud);
  el('div', 'zd-patches-head', 'Patches', patchBox);
  const patchList = el('ul', 'zd-patch-list', undefined, patchBox);
  el('div', 'zd-crosshair', undefined, hud);
  const speed = el('div', 'zd-speed', '', hud);
  speed.hidden = true;
  const wallet = el('div', 'zd-wallet', undefined, hud);
  el('span', 'zd-wallet-label', 'Budget', wallet);
  const budget = el('span', 'zd-budget', formatBudget(SHOOTER_TUNING.startBudget), wallet);
  const toolkit = el('span', 'zd-toolkit', 'Toolkit', wallet);
  toolkit.title = 'Toolkit: every step is faster';
  toolkit.hidden = true;
  const toasts = el('div', 'zd-toasts', undefined, hud);
  const map = el('canvas', 'zd-map', undefined, hud);
  const panel = el('div', 'zd-panel', undefined, hud);
  panel.hidden = true;
  const panelHead = el('div', 'zd-panel-head', '', panel);
  const panelList = el('ol', 'zd-panel-steps', undefined, panel);
  const stepEls = PANEL_STEPS.map((step, i) => {
    const li = el('li', 'zd-panel-step', undefined, panelList);
    el('span', 'zd-key', String(i + 1), li);
    const label = el('span', 'zd-label', step, li);
    li.style.setProperty('--step-color', STEP_COLORS[step]);
    return { li, label };
  });
  const panelPatch = el('div', 'zd-panel-patch', '', panel);
  const panelHint = el('div', 'zd-panel-hint', '', panel);
  const bar = el('div', 'zd-bar', undefined, panel);
  const barFill = el('div', 'zd-bar-fill', undefined, bar);

  let ticketKey = '';
  let slaFills: { fill: HTMLElement; bar: HTMLElement; rackId: string }[] = [];
  let patchKey = '';
  let floorBase: HTMLCanvasElement | null = null;
  /** What the base was drawn for: the floor, the CSS size and the pixel ratio. */
  let baseFor: { floor: FloorDef; w: number; h: number; dpr: number } | null = null;
  let toastList: { el: HTMLElement; until: number }[] = [];
  let lastTime = 0;

  const renderTickets = (s: Shift) => {
    const key = s.open.map((o) => `${o.rackId}:${o.ticket.stepIndex}:${o.breached}`).join('|');
    if (key === ticketKey) return;
    ticketKey = key;
    slaFills = [];
    tickets.replaceChildren(
      ...s.open.map((o) => {
        const card = el('div', `zd-ticket${o.breached ? ' breached' : ''}`);
        card.dataset.rack = o.rackId;
        const head = el('div', 'zd-ticket-head', undefined, card);
        el('span', 'zd-ticket-title', o.ticket.type.title, head);
        el('span', 'zd-ticket-loc', o.ticket.location, head);
        const steps = el('ol', 'zd-ticket-steps', undefined, card);
        o.ticket.type.steps.forEach((step, i) => {
          const state =
            i < o.ticket.stepIndex ? 'done' : i === o.ticket.stepIndex ? 'next' : 'pending';
          const li = el('li', `zd-step ${state}`, undefined, steps);
          const op = el('span', 'zd-op', step === 'PIT' ? 'HANDS-ON' : step, li);
          if (state === 'next') op.style.background = STEP_COLORS[step];
        });
        const sla = el('div', 'zd-sla', undefined, card);
        const fill = el('div', 'zd-sla-fill', undefined, sla);
        slaFills.push({ fill, bar: sla, rackId: o.rackId });
        return card;
      }),
    );
  };

  const renderPatches = (s: Shift) => {
    const key = s.patches.map((p) => `${p.id}:${p.applied}`).join('|');
    if (key === patchKey) return;
    patchKey = key;
    patchList.replaceChildren(
      ...s.patches.map((p) => {
        const li = el('li', `zd-patch${p.applied ? ' applied' : ''}`);
        el('span', 'zd-check', p.applied ? '✔' : '☐', li);
        el('span', 'zd-patch-name', p.name, li);
        el('span', 'zd-patch-target', p.targetId, li);
        return li;
      }),
    );
  };

  const renderMap = (s: Shift) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(s.floor.width * MAP_SCALE);
    const h = Math.round(s.floor.depth * MAP_SCALE);
    const same =
      baseFor &&
      baseFor.floor === s.floor &&
      baseFor.w === w &&
      baseFor.h === h &&
      baseFor.dpr === dpr;
    if (!floorBase || !same) {
      floorBase = drawFloorBase(s.floor, w, h, dpr);
      baseFor = { floor: s.floor, w, h, dpr };
      // Canvas sizes are whole pixels; a ratio such as 1.8 would truncate.
      map.width = Math.floor(w * dpr);
      map.height = Math.floor(h * dpr);
      map.style.width = `${w}px`;
      map.style.height = `${h}px`;
    }
    const ctx = map.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, map.width, map.height);
    ctx.drawImage(floorBase, 0, 0);
    ctx.scale(dpr * MAP_SCALE, dpr * MAP_SCALE);
    const find = (id: string) => s.targets.get(id);
    const mark = (t: Target | undefined, color: string, r: number) => {
      if (!t) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(t.x, t.z, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const dot = (x: number, z: number, color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of s.pickups) {
      if (p.kind === 'po' && p.respawnAt === null) dot(p.x, p.z, '#3ddc97', 1.1);
    }
    for (const v of s.vendors) {
      dot(v.x, v.z, s.time < v.distractedUntil ? '#8a6a3a' : '#f28c28', 0.9);
    }
    for (const p of s.patches) if (!p.applied) mark(find(p.targetId), '#4d9de0', 1.4);
    for (const o of s.open) mark(find(o.rackId), o.breached ? '#ff2d2d' : '#e15554', 1.4);
    // The player: a triangle that points the way the player looks.
    const { x, z, yaw } = s.player;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.moveTo(x + fx * 2.2, z + fz * 2.2);
    ctx.lineTo(x - fx * 1.2 + fz * 1.2, z - fz * 1.2 - fx * 1.2);
    ctx.lineTo(x - fx * 1.2 - fz * 1.2, z - fz * 1.2 + fx * 1.2);
    ctx.closePath();
    ctx.fill();
  };

  const renderPanel = (s: Shift, facing: Target | null) => {
    setHidden(panel, !facing);
    if (!facing) return;
    const open = s.open.find((o) => o.rackId === facing.id);
    const work = s.work && s.work.targetId === facing.id ? s.work : null;
    if (open) {
      if (panel.dataset.mode !== 'rack') panel.dataset.mode = 'rack';
      setText(panelHead, `${open.ticket.type.title} · ${open.ticket.location}`);
      setHidden(panelList, false);
      setHidden(panelPatch, true);
      const picked = s.selected?.rackId === facing.id ? s.selected.step : null;
      stepEls.forEach(({ li, label }, i) => {
        const step = PANEL_STEPS[i] as Step;
        setText(label, panelLabel(step, open.ticket.type.pitWork));
        if (li.classList.contains('selected') !== (picked === step)) {
          li.classList.toggle('selected', picked === step);
        }
      });
      setText(
        panelHint,
        picked === null
          ? 'Pick a step: 1-9'
          : `Hold E: ${panelLabel(picked, open.ticket.type.pitWork)}`,
      );
    } else {
      if (panel.dataset.mode !== 'patch') panel.dataset.mode = 'patch';
      const patch = s.patches.find((p) => p.targetId === facing.id && !p.applied);
      setText(panelHead, `${facing.kind} ${facing.id}`);
      setHidden(panelList, true);
      setHidden(panelPatch, false);
      setText(panelPatch, patch ? `Patch ${patch.id} “${patch.name}”` : '');
      setText(panelHint, 'Hold E to apply');
    }
    const frac = work ? Math.min(1, work.progress / work.duration) : 0;
    setTransform(barFill, `scaleX(${frac})`);
  };

  return {
    el: hud,
    update(s, facing) {
      lastTime = s.time;
      const left = SHOOTER_TUNING.shiftSeconds - s.time;
      setText(clock, formatClock(left));
      if (clock.classList.contains('low') !== left <= 30) clock.classList.toggle('low', left <= 30);
      renderTickets(s);
      for (const f of slaFills) {
        const o = s.open.find((x) => x.rackId === f.rackId);
        if (!o) continue;
        const total = o.ticket.deadline - o.ticket.issuedAt;
        const frac = Math.max(0, Math.min(1, (o.ticket.deadline - s.time) / Math.max(1, total)));
        setTransform(f.fill, `scaleX(${o.breached ? 1 : frac})`);
        const low = o.breached || frac < 0.25;
        if (f.bar.classList.contains('low') !== low) f.bar.classList.toggle('low', low);
      }
      renderPatches(s);
      const text = speedText(closeVendors(s));
      setText(speed, text);
      setHidden(speed, text === '');
      setText(budget, formatBudget(s.budget));
      const broke = s.budget < SHOOTER_TUNING.shotCost;
      if (budget.classList.contains('empty') !== broke) budget.classList.toggle('empty', broke);
      setHidden(toolkit, !s.toolkit);
      renderMap(s);
      renderPanel(s, facing);
      toastList = toastList.filter((t) => {
        if (t.until > s.time) return true;
        t.el.remove();
        return false;
      });
    },
    onEvents(events, s) {
      for (const e of events) {
        const t = eventToast(e, s);
        if (!t) continue;
        const node = el('div', `zd-toast ${t.kind}`, t.text, toasts);
        toastList.push({ el: node, until: lastTime + TOAST_TIME });
        while (toastList.length > 4) toastList.shift()?.el.remove();
      }
    },
    clear() {
      ticketKey = '';
      patchKey = '';
      tickets.replaceChildren();
      patchList.replaceChildren();
      toasts.replaceChildren();
      toastList = [];
      lastTime = 0;
      panel.hidden = true;
    },
  };
}
