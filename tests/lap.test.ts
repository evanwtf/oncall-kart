import { describe, expect, it } from 'vitest';
import { lapStart, lapUpdate, raceProgress, type LapState } from '../src/logic/lap';
import { lineTrack } from './helpers';

const track = lineTrack(100, 4);

/** Drive from s `from` by `delta` metres (signed) in 0.5 m moves. */
function drive(state: LapState, from: number, delta: number, t0 = 0) {
  let s = from;
  let st = state;
  let laps = 0;
  const n = Math.abs(delta) / 0.5;
  for (let i = 0; i < n; i++) {
    const next = (((s + Math.sign(delta) * 0.5) % 100) + 100) % 100;
    const r = lapUpdate(st, s, next, track, t0 + i * 0.01);
    st = r.state;
    if (r.completedLap) laps++;
    s = next;
  }
  return { state: st, s, laps };
}

describe('laps', () => {
  it('completes a lap when driving forward all the way round', () => {
    const r = drive(lapStart(0), 2, 100);
    expect(r.laps).toBe(1);
    expect(r.state.completed).toBe(1);
  });

  it('does not count forward over the line, back, and forward again', () => {
    let r = drive(lapStart(0), 2, 97); // to 99
    r = drive(r.state, r.s, 3); // over the line to 2
    expect(r.laps).toBe(1);
    r = drive(r.state, r.s, -4); // back over the line to 98
    r = drive(r.state, r.s, 4); // forward again to 2
    expect(r.laps).toBe(0);
    expect(r.state.completed).toBe(1);
  });

  it('does not count backward from the grid and forward again', () => {
    let r = drive(lapStart(0), 2, -4); // to 98
    r = drive(r.state, r.s, 4);
    expect(r.laps).toBe(0);
    expect(r.state.completed).toBe(0);
  });

  it('does not count a lap driven backward', () => {
    let r = drive(lapStart(0), 2, -100);
    expect(r.laps).toBe(0);
    r = drive(r.state, r.s, 100);
    expect(r.laps).toBe(0);
    r = drive(r.state, r.s, 100);
    expect(r.laps).toBe(1);
  });

  it('wiggling over a sector boundary counts once', () => {
    let r = drive(lapStart(0), 2, 23); // to 25: sector 1
    for (let i = 0; i < 5; i++) {
      r = drive(r.state, r.s, -1);
      r = drive(r.state, r.s, 1);
    }
    expect(r.state.sector).toBe(1);
    r = drive(r.state, r.s, 77);
    expect(r.laps).toBe(1);
  });

  it('does not count a lap when sectors are skipped (a cut across the infield)', () => {
    let st = lapStart(0);
    st = lapUpdate(st, 2, 60, track, 1).state; // jumps far: ignored
    const r = drive(st, 60, 42);
    expect(r.laps).toBe(0);
  });

  it('keeps the best lap time', () => {
    let st = lapStart(0);
    let s = 2;
    let t = 0;
    const times: number[] = [];
    for (const lapSeconds of [50, 40, 45]) {
      const dt = lapSeconds / 200;
      for (let i = 0; i < 200; i++) {
        const next = (s + 0.5) % 100;
        t += dt;
        const r = lapUpdate(st, s, next, track, t);
        st = r.state;
        if (r.completedLap) times.push(t);
        s = next;
      }
    }
    expect(st.completed).toBe(3);
    expect(st.bestLap).not.toBeNull();
    expect(st.bestLap as number).toBeCloseTo(40, 0);
  });

  it('measures race progress', () => {
    expect(raceProgress({ ...lapStart(0), completed: 2 }, 50, 100)).toBeCloseTo(2.5);
  });
});

describe('raceProgress behind the line', () => {
  it('ranks a kart that backed over the line behind one that did not (issue #1)', () => {
    const back = drive(lapStart(0), 2, -4); // to 98, sector -1
    expect(back.state.sector).toBe(-1);
    const stayed = drive(lapStart(0), 2, 1); // to 3
    expect(raceProgress(back.state, back.s, 100)).toBeLessThan(
      raceProgress(stayed.state, stayed.s, 100),
    );
    expect(raceProgress(back.state, back.s, 100)).toBeCloseTo(-0.02, 9);
  });

  it('counts a kart one lap down when it backs a whole lap', () => {
    const r = drive(lapStart(0), 2, -100); // back to 2, sector -4
    expect(raceProgress(r.state, r.s, 100)).toBeCloseTo(-0.98, 9);
  });

  it('is continuous over the line when a lap completes', () => {
    const before = drive(lapStart(0), 2, 97); // to 99
    const after = drive(before.state, before.s, 2); // to 1, lap 1
    expect(raceProgress(before.state, before.s, 100)).toBeCloseTo(0.99, 9);
    expect(raceProgress(after.state, after.s, 100)).toBeCloseTo(1.01, 9);
  });
});
