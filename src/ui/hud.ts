import type { Race, RaceEvent } from '../logic/race';
import { STEP_COLORS } from '../logic/ops';
import { nextStep } from '../logic/ticket';

/** m:ss.t */
export function formatTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const TOAST_SECONDS = 1.6;

export interface Hud {
  el: HTMLElement;
  update(race: Race): void;
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

  return {
    el,
    update(race) {
      const k = race.karts[race.playerId];
      if (!k) return;
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
        if ('kartId' in e && e.kartId !== race.playerId) continue;
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
    },
    clear() {
      for (const t of toastList) t.el.remove();
      toastList = [];
      stepsKey = '';
    },
  };
}
