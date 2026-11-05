# oncall-kart phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sound and polish. The game gets synthesised sound effects, an original looping tune and a mute toggle, and two follow-up issues are fixed: #3 (render polish) and #4 (CI and tests).

**Architecture:**
- All audio is synthesised at run time with the Web Audio API. There are no audio files and no libraries.
- `src/audio/` owns the `AudioContext`. It starts on the first user gesture, because Safari blocks sound before one.
- A pure function maps each frame's `RaceEvent[]` and player state to a list of sound cues. Unit tests cover that function. The synth code only plays cues.

**Spec:** `docs/superpowers/specs/2026-11-04-oncall-kart-design.md`, section "Sound". Earlier plans: phase 1, touch, phase 2 in `docs/superpowers/plans/`.

## Global Constraints

- Every Global Constraint of the earlier plans still holds.
- **The music is original.** Compose a new melody. It must not quote, imitate or "sound like" the music of any existing game. Write the notes as data in the repo. The same rule covers jingles and sound effects.
- No audio files, no runtime third-party requests, no new runtime dependencies.
- **Mute:**
  - M toggles it on the keyboard. A Sound item in the pause menu toggles it on touch.
  - The choice is stored in `localStorage`, wrapped in try/catch.
  - When muted, no audio node produces sound. The `AudioContext` may stay alive.
- Pausing or hiding the tab ducks the music and stops the engine sound. Resuming restores both.
- The audio work must not cost frames. Schedule notes ahead with a lookahead scheduler, and do not create nodes every frame for the engine sound.
- Version `0.4.0` when this plan is done.

## Review Focus

1. **Safari's gesture rule.** The context is created or resumed inside a real keydown or pointerdown handler. A first touch on a phone must start sound. Sound must also come back after an iOS app switch: when the context reports `interrupted` or `suspended`, resume it on the next gesture.
2. **Node leaks.** Every one-shot sound disconnects its nodes after it ends. Over a 10-lap race the count of live nodes stays bounded. Test it with a fake context that counts connects and disconnects.
3. **Event storms.** Eight karts can hit, pick up and use items in the same frame. Sounds of other karts are culled by distance, and each cue kind plays at most N times per 100 ms, so the mix does not clip.
4. **Mute everywhere.** A cue that is already scheduled stops sounding when the player mutes mid-race. A restart while muted stays muted.
5. **No audio support.** If `AudioContext` is missing, or its constructor throws, the game still runs silently, with no console error.

---

### Task 1: Cue mapping (pure, TDD)

**Files:** Create `src/audio/cues.ts`; test `tests/cues.test.ts`.

**Interfaces (Produces):**
```ts
export type Cue =
  | { kind: 'countdown'; n: 3 | 2 | 1 } | { kind: 'go' }
  | { kind: 'gate-ok' } | { kind: 'gate-wrong' } | { kind: 'ticket-closed' } | { kind: 'sla-breach' }
  | { kind: 'pit' } | { kind: 'lap' } | { kind: 'final-lap' } | { kind: 'finish'; place: number }
  | { kind: 'drift-stage'; stage: 1 | 2 | 3 } | { kind: 'boost' }
  | { kind: 'item-pick' } | { kind: 'item-use'; item: ItemKind } | { kind: 'hit'; outcome: 'blocked' | 'rolled-back' | 'spun'; gain: number };
export interface CueState { lastCountdown: number | null; lastDriftStage: number; recent: Map<string, number[]> }
export function cuesFor(race: Race, events: readonly RaceEvent[], state: CueState, now: number): Cue[];
export const HEAR_RANGE: number;   // metres; hits on other karts fade to 0 at this range
```
- [ ] Failing tests:
  - Each countdown number gives one cue, once.
  - `go` gives one cue.
  - The player's `step-ok` gives `gate-ok`; a bot's `step-ok` gives nothing.
  - A `hit` on a bot 10 m away has `gain` > 0; one at `HEAR_RANGE` + 1 m gives no cue.
  - Starting the last lap gives `final-lap`.
  - A drift that reaches each stage gives one `drift-stage` cue per stage.
  - The rate limit (Review Focus 3): 20 hits in one frame give at most `MAX_PER_KIND` cues.
- [ ] Implement. Tests PASS. Commit `feat(audio): map race events to sound cues`.

### Task 2: Synth, music and mute

**Files:**
- Create `src/audio/engine.ts` (context, master and music buses, mute, gesture unlock);
- create `src/audio/sfx.ts` (one function per cue);
- create `src/audio/music.ts` (a lookahead sequencer and the tune as data);
- create `src/audio/engineSound.ts` (a continuous engine tone with pitch set by speed);
- modify `src/game.ts`, `src/input.ts` (M becomes an action), `src/ui/screens.ts` (Sound item in the pause menu, mute icon in the HUD), and `src/ui/hud.ts`;
- test `tests/audio.test.ts`, with a fake `AudioContext`.

**Interfaces (Produces):**
```ts
export interface Audio { unlock(): void; play(cues: readonly Cue[]): void; setEngine(speed: number, onRoad: boolean): void; setMusic(state: 'title' | 'race' | 'final-lap' | 'off'): void; setPaused(p: boolean): void; setMuted(m: boolean): void; muted(): boolean; dispose(): void }
export function createAudio(factory?: () => AudioContext | null): Audio;   // the factory is injectable for tests; it returns null when unsupported
```
- **Sound palette (my call; keep it short, bright and arcade-like):**
  - countdown: short blips, with a higher note on GO;
  - gate-ok: a rising two-note chime;
  - gate-wrong: a low buzz;
  - ticket-closed: a fast three-note arpeggio;
  - sla-breach: an original pager-style beep pattern;
  - pit: ratchet clicks;
  - item-pick: a blip;
  - item use: a whoosh for coffee, a reverse sweep for rollback, a shimmer for firewall, a chirp for page, a splat for spill;
  - hit: a thud;
  - drift stages: rising ticks;
  - boost: a filtered-noise whoosh;
  - lap and final lap: a chime and a short jingle;
  - finish: a fanfare scaled by place.
- **Music:**
  - one original loop of 16 to 32 bars in square, triangle and noise voices, at about 140 BPM;
  - the final lap plays the same loop at about +8% tempo;
  - the title screen gets a calmer variant;
  - the music bus sits about 6 dB under the effects.
- [ ] Failing tests with the fake context:
  - nothing is created before `unlock()`;
  - `unlock()` creates or resumes the context once;
  - after 1,000 `play()` calls of every cue kind, live nodes return to 0 once their end times pass (Review Focus 2);
  - `setMuted(true)` sets the master gain to 0 at once (Review Focus 4);
  - a factory that returns null, or throws, gives a working no-op `Audio` (Review Focus 5).
- [ ] Implement. Wire the game:
  - `unlock()` runs on the first keydown and the first pointerdown, and again after the context reports `suspended` or `interrupted` (Review Focus 1);
  - M toggles mute, and the pause menu gets a "Sound: On/Off" item;
  - add the debug hooks `audioState()` (returns `'locked' | 'running' | 'suspended' | 'unsupported'`) and `muted()`.
- [ ] Tests PASS. Commit `feat(audio): synthesised sound, original music and mute`.

### Task 3: Issues #3 and #4

- [ ] **#3:**
  - Freeze the wheels, sparks and other animation on the pause screen.
  - Snap the chase camera on respawn, so nothing smears or swoops.
  - When the device pixel ratio changes, for example when the window moves to another display, resize the renderer. Use `matchMedia('(resolution: Xdppx)')`.
  - Close #3 in the commit message.
- [ ] **#4:**
  - The e2e job uses the Node version in `.nvmrc`. Either install it with `actions/setup-node` inside the container, or add a test that pins the Node major version in the Playwright image to `.nvmrc`. Pick whichever works in the container; check under Colima.
  - Add an e2e test for WebGL context loss and restore: call `WEBGL_lose_context.loseContext()`, then `restoreContext()`, then assert the race keeps rendering (`renderInfo()` counts move) and no errors appear.
  - Close #4.
- [ ] Commit `fix: render polish and CI Node version; context-loss test (closes #3, closes #4)`.

### Task 4: E2E, docs, version

- [ ] E2E in every project:
  - after the first key press or tap, `audioState()` is `'running'` (Chromium) or `'running'` / `'suspended'` (WebKit headless can refuse audio, so accept both, but never `'locked'` after a gesture);
  - M flips `muted()`, and the state survives a reload;
  - no console errors.
- [ ] README: add M to the controls table, and the Sound item in the pause menu. Add a `docs/changelog.md` section for `0.4.0`. Bump the version to `0.4.0`.
- [ ] Run the full check, plus the container run under Colima.
- [ ] Commit `feat: sound e2e and docs; v0.4.0`.
