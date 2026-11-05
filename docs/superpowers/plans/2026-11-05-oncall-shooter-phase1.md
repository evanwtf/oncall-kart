# Shooter phase 1 ("walk and fix") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A start screen that picks the kart game or the shooter, and a playable first shooter build: walk a data-centre floor, fix servers that break at random, apply patches, and end a 3-minute shift with one of three endings. No vendors and no money gun yet (phase 2), no sound or touch (phase 3).

**Architecture:**
- The shooter's rules are pure TypeScript in `src/shooter/logic/`: no three.js, no DOM, a fixed step and the seeded RNG. This is the same rule as `src/logic/`, and ESLint enforces it for both folders.
- Rendering is in `src/shooter/render/`, the DOM screens and HUD in `src/shooter/ui/`, and the loop in `src/shooter/game.ts`.
- The two games share `src/logic/ops.ts`, `runbooks.ts`, `ticket.ts` and `rng.ts`. They are imported, never copied.
- The kart game changes only where routing needs it.

**Tech Stack:** TypeScript, Vite, three.js, Vitest, Playwright, as in the kart game.

**Spec:** `docs/superpowers/specs/2026-11-05-oncall-shooter-design.md`. Context: the kart design and its plans in `docs/superpowers/`, and `AGENTS.md`.

## Global Constraints

- **Original work only:** no names, characters, monsters, weapon designs, maps, HUD faces, music, sound effects or logos from any existing shooter, in particular id Software's and Valve's. The names of those games appear nowhere in the repo or the site.
- **No real names:** no real company, product or brand names, and no real CVE numbers or real vulnerability nicknames. Patch names are clearly fictional.
- **No blood or gore,** and no realistic guns.
- **No telemetry,** no cookies, no third-party requests at runtime. No new runtime dependency.
- **Pure logic:** `src/logic/` and `src/shooter/logic/` never import three.js or touch the DOM.
- **The kart game must not break.** Its unit tests and e2e tests stay green.
- **Browsers:** Chrome and Safari on macOS, WebGL 2. 60 fps on the weakest current MacBook Air. Draw calls stay under about 150.
- **Public repo:** no hostnames, LAN IPs, home-directory paths or secret names. No Claude session links or IDs in commits or files.
- **Version:** `0.5.0` when this plan is done (`package.json` only).

## Review Focus

1. **Pointer lock in both browsers.** Possible events: the lock is refused, Esc releases it, the window loses focus, or the tab hides. In each case the shift pauses, every held key is released, and no console error appears. Chrome refuses a new lock for about 1 s after Esc, so the first Resume click can fail. Resume must then work on a later click, and the game must not get stuck.
2. **Hold-to-work edge cases.** Let go at 99%: no progress. Walk up to the rack with E already held: no work starts until a step is picked. Move or turn away mid-step: the step is cancelled. A step that completes on the same tick the clock reaches 0:00 counts before the ending.
3. **Overlapping targets.** Two broken racks side by side: the panel works on the rack you face, and it shows that rack's location. A patch target never breaks. A break when every candidate rack is already broken is skipped and does not crash.
4. **Time jumps.** A hidden tab, a long frame or a breakpoint must not run the 3:00 clock out or skip a break. A hidden tab pauses the shift, and the loop catches up at most `MAX_CATCH_UP`, as in the kart game.
5. **The kart game behind the picker.** `?game=kart` keeps every kart feature and the kart's debug hooks. A bare URL shows the picker, and both games can return to it.

---

### Task 1: Picker and routing

**Files:**
- Create `src/picker.ts` and `src/ui/picker.css`.
- Modify `src/main.ts`, `src/ui/screens.ts` (a "Switch game" button on the kart title screen), `index.html` (description: two games), `playwright.config.ts`, `e2e/smoke.spec.ts` and `e2e/touch.spec.ts` (URLs gain `game=kart`).
- Create `src/shooter/game.ts`, a stub that renders "Zero Down: coming in this build" until Task 4.
- Test in `tests/picker.test.ts`.

**Interfaces (Produces):**
```ts
export type GameId = 'kart' | 'shooter';
export function parseGame(search: string): GameId | null;          // '?game=shooter&seed=1' -> 'shooter'; unknown values -> null
export function gameUrl(href: string, game: GameId | null): string; // sets or removes `game`, keeps every other param and the path
export function showPicker(root: HTMLElement): void;                // two <button data-game="..."> cards
// src/shooter/game.ts
export function startShooter(canvas: HTMLCanvasElement, ui: HTMLElement): void;
```
- [ ] Failing tests:
  - `parseGame('?game=kart')` returns `'kart'`.
  - `parseGame('')` and `parseGame('?game=nope')` return `null`.
  - `gameUrl('https://x/oncall-kart/?seed=1&debug=1', 'shooter')` keeps `seed=1` and `debug=1`, adds `game=shooter`, and keeps the path.
  - `gameUrl(..., null)` removes only `game`.
- [ ] Implement the picker:
  - Left/right arrows (or A/D) move the selection. Enter, a click or a tap opens the selected game with `location.assign(gameUrl(location.href, id))`.
  - The shooter card notes "Needs a mouse and keyboard" when `matchMedia('(pointer: coarse)')` matches. The card still opens.
- [ ] Wire `main.ts`:
  - It checks for WebGL 2 first, as today.
  - Then it reads `parseGame(location.search)`: `kart` calls `startGame`, `shooter` calls `startShooter`, and `null` calls `showPicker`.
- [ ] Kart title screen: add a "Switch game" button that goes to `gameUrl(location.href, null)`.
- [ ] Update the kart e2e URLs.
- [ ] Add a picker test to `smoke.spec.ts`:
  - a bare URL shows both cards;
  - clicking the kart card reaches the kart `title` screen;
  - no console errors.
- [ ] The full kart e2e passes in Chromium and WebKit.
- [ ] Commit `feat: start screen that picks the game`.

### Task 2: The floor, collision and movement (pure, TDD)

**Files:**
- Create `src/shooter/logic/tuning.ts`, `floor.ts` and `player.ts`.
- Modify `eslint.config.*` to add `src/shooter/logic/**/*.ts` to the pure-logic rule.
- Tests in `tests/shooter/floor.test.ts` and `tests/shooter/player.test.ts`.

**Interfaces (Produces):**
```ts
// tuning.ts: starting values; tune by feel
export const SHOOTER_TUNING = { shiftSeconds: 180, breaks: 6, firstBreak: 10, quietEnd: 15, minBreakGap: 8,
  slaBase: 35, slaPerStep: 7, opSeconds: 2, handsOnSeconds: 4, patchSeconds: 3, patches: 3,
  runSpeed: 6, accel: 60, playerRadius: 0.35, eyeHeight: 1.6, reach: 1.8, faceAngleDeg: 35,
  mouseSensitivity: 0.0025, pitchLimitDeg: 80 } as const;
// floor.ts
export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Target { id: string; kind: 'rack' | 'switch' | 'firewall'; x: number; z: number; /** unit vector out of the front */ fx: number; fz: number; box: Box }
export interface FloorDef { width: number; depth: number; walls: Box[]; racks: Target[]; devices: Target[];
  areas: { name: 'Data hall A' | 'Data hall B' | 'Network room' | 'Break room' | 'Loading dock'; box: Box }[];
  spawn: { x: number; z: number; yaw: number }; dock: { x: number; z: number } }
export const FLOOR: FloorDef;
export function frontPoint(t: Target, distance: number): { x: number; z: number };
// player.ts: yaw 0 looks toward -z; forward moves along (-sin yaw, -cos yaw)
export interface Player { x: number; z: number; vx: number; vz: number; yaw: number; pitch: number }
export interface MoveInput { forward: number; strafe: number }   // each -1..1
export function moveWithCollision(p: { x: number; z: number }, dx: number, dz: number, radius: number, boxes: readonly Box[]): { x: number; z: number };
export function stepPlayer(p: Player, input: MoveInput, dt: number, boxes: readonly Box[]): void;
```
- **Floor layout (left to the builder, inside the spec):**
  - Two data halls of rack rows, a network room with the switches and firewalls, a break room with the spawn point, and a loading dock.
  - Rack ids are `r1`, `r2`, and so on. Each rack's front faces an aisle at least 1.6 m wide.
  - Racks are standard 0.6 × 1.2 m boxes.
- [ ] Failing tests:
  - Rack ids are unique and match `/^r\d+$/`.
  - The floor has at least 60 racks, at least 2 switches and at least 2 firewalls.
  - No two boxes overlap. The spawn point clears every box by `playerRadius`.
  - Every rack's and device's `frontPoint(t, 0.8)` is reachable from the spawn point. Check it with a BFS on a 0.25 m grid that inflates every box by `playerRadius`. The BFS is a test helper.
  - Walk time: the longest BFS path from the spawn point to any target, divided by `runSpeed`, is between 15 and 27 s.
  - `moveWithCollision` cannot push a player into a box: a 1 m move toward a box face ends at `face - radius`. A diagonal move into a wall keeps its component along the wall.
  - 10 s of `stepPlayer` at forward 1 into a wall, at dt 1/120, never ends inside a box.
  - `stepPlayer` reaches at least 0.9 × `runSpeed` within 0.2 s.
  - Forward plus strafe together never exceed `runSpeed`: the input is normalized.
- [ ] Implement. PASS. Commit `feat(shooter): floor, collision and movement`.

### Task 3: The shift (pure, TDD)

**Files:**
- Create `src/shooter/logic/shift.ts`, `breaks.ts` and `patches.ts`.
- Tests in `tests/shooter/breaks.test.ts` and `tests/shooter/shift.test.ts`.

**Interfaces:**
- Consumes: `issueTicket`, `applyStep`, `nextStep` and `Ticket` from `src/logic/ticket.ts`; `TICKET_TYPES`; `OPS`; `Step`; `makeRng` and `pick`; Task 2.
- Produces:
```ts
// breaks.ts
export function breakTimes(rng: Rng): number[];   // SHOOTER_TUNING.breaks times, ascending
export function shooterSla(type: TicketType): number;   // slaBase + slaPerStep * steps.length
// patches.ts
export interface Patch { id: string; name: string; targetId: string; applied: boolean }  // id like 'ZD-2026-0042'; name a fictional nickname
export function rollPatches(rng: Rng, floor: FloorDef): Patch[];   // one switch, one firewall, one rack
// shift.ts
export const PANEL_STEPS: readonly Step[];   // [...OPS, 'PIT']; number key n picks PANEL_STEPS[n - 1]
export type Ending = 'clean' | 'rough' | 'fired';
export interface OpenTicket { rackId: string; ticket: Ticket; breached: boolean }
export interface Work { targetId: string; step: Step | null; progress: number; duration: number }   // step null = a patch
export interface ShiftStats { ticketsClosed: number; slaBreaches: number; wrongSteps: number; patchesApplied: number }
export interface Shift { time: number; floor: FloorDef; player: Player; open: OpenTicket[]; patches: Patch[];
  selected: Step | null; work: Work | null; stats: ShiftStats; ended: Ending | null; /* plus rng and schedule */ }
export interface ShiftInput { move: MoveInput; yaw: number; pitch: number; work: boolean; pick: Step | null }
export type ShiftEvent =
  | { type: 'break'; rackId: string; ticket: Ticket } | { type: 'step-ok'; rackId: string; step: Step }
  | { type: 'step-wrong'; rackId: string; step: Step } | { type: 'alarm'; rackId: string }
  | { type: 'ticket-closed'; rackId: string } | { type: 'patch-applied'; patchId: string }
  | { type: 'work-cancelled'; targetId: string } | { type: 'sla-breach'; rackId: string }
  | { type: 'shift-end'; ending: Ending };
export function createShift(seed: number, floor?: FloorDef): Shift;
export function stepShift(s: Shift, input: ShiftInput, dt: number): ShiftEvent[];   // mutates s, like stepRace
export function facingTarget(s: Shift): Target | null;   // nearest broken rack or unapplied patch target within reach and faceAngleDeg
export function endingFor(s: Shift): Ending;
```
- **Rules from the spec, with my calls marked:**
  - A ticket's `location` is `<rackId>-u<NN>` (for example `r12-u07`) and its deadline is `time + shooterSla(type)`. Other ticket fields come from `issueTicket`.
  - A break picks a random rack that is healthy and not a patch target. It is skipped if there is none (my call).
  - No break in the last `quietEnd` s (my call).
  - Work runs while `input.work` is true, a target is faced, and either a step is selected (racks) or the target is an unapplied patch.
  - Duration: `opSeconds`, or `handsOnSeconds` for `PIT`, or `patchSeconds` for a patch.
  - Movement input, letting go of E, or a change of faced target cancels the work (`work-cancelled`), and the progress drops to 0.
  - After a step completes, right or wrong, `selected` clears.
  - Player movement is ignored while working.
- [ ] Failing tests:
  - `breakTimes(makeRng(1))`: 6 times; the first is 10; each gap is at least 8; the last is at most 165; the same seed gives the same list.
  - `shooterSla` of bad-cpu is 77.
  - At t = 10 a `break` event fires; the open ticket's `location` starts with its `rackId-u`; the rack is not a patch target.
  - `facingTarget`: at `frontPoint(rack, 0.8)` facing the rack, it returns the rack; turned 90° away, or 3 m back, it returns null.
  - With two broken racks side by side, it returns the one in front (Review Focus 3).
  - Right step: pick the next step, hold `opSeconds` + one step → `step-ok`, and `stepIndex` goes up by 1.
  - Release at `opSeconds - 0.05` → no step, and `work` is null.
  - E held before a pick → no work (Review Focus 2).
  - Movement input mid-step → `work-cancelled`.
  - `PIT` takes `handsOnSeconds`.
  - Wrong step → `step-wrong` and `alarm`; `wrongSteps` is 1; `stepIndex` is unchanged.
  - The full runbook → `ticket-closed`, the rack leaves `open`, and `ticketsClosed` is 1.
  - The SLA passes → exactly one `sla-breach`, the ticket stays open, and `slaBreaches` is 1.
  - A patch: face its target, hold `patchSeconds` → `patch-applied`, with no pick needed.
  - `endingFor`:

    | Patches | Broken racks | Ending |
    | --- | --- | --- |
    | all applied | 0 | clean |
    | all applied | 1 | rough |
    | 1 missing | 0 | fired |
    | 1 missing | 1 | fired |
  - At 180 s, exactly one `shift-end`. Later steps return `[]` and change nothing.
  - A step that completes on the final tick counts in the ending (Review Focus 2).
  - A floor fixture with 1 non-patch rack gets a second break while the rack is broken → skipped, no throw (Review Focus 3).
  - The same seed and the same inputs give the same event list.
- [ ] Implement. Write the fictional patch nicknames as data in `patches.ts`. PASS. Commit `feat(shooter): the shift, breaks, fixes and patches`.

### Task 4: Render, input, HUD, screens and the loop

**Files:**
- Create `src/shooter/render/scene.ts`, `src/shooter/input.ts`, `src/shooter/ui/screens.ts`, `src/shooter/ui/hud.ts` and `src/shooter/ui/shooter.css`.
- Replace the stub in `src/shooter/game.ts`.
- Test in `tests/shooter/input.test.ts` (jsdom).

**Interfaces (Produces):**
```ts
// input.ts
export type ShooterAction = 'pause' | 'confirm';
export interface ShooterInput { read(): ShiftInput; takeActions(): ShooterAction[]; requestLock(): void; locked(): boolean; setSensitivity(v: number): void; dispose(): void }
export function createShooterInput(win: Window, canvas: HTMLCanvasElement): ShooterInput;
// game.ts debug hooks on window.__oncallShooter (declare in src/env.d.ts)
export interface ShooterHooks { version: string; screen(): 'briefing' | 'playing' | 'paused' | 'ended';
  clockLeft(): number; openTickets(): { rackId: string; title: string; next: Step | null }[];
  patches(): { id: string; targetId: string; applied: boolean }[]; stats(): ShiftStats; ending(): Ending | null;
  player(): { x: number; z: number; yaw: number }; renderInfo(): { calls: number; triangles: number };
  // only with ?debug=1:
  faceTarget?(id: string): void; breakNow?(rackId: string, typeId: string): void; setClockLeft?(s: number): void; start?(): void }
```
- [ ] **Input** (test-first in jsdom):
  - Keys: W A S D and the arrows move. `Digit1`-`Digit9` and `Numpad1`-`Numpad9` pick `PANEL_STEPS`. E is held to work. P and Esc pause.
  - With the pointer locked, `movementX` and `movementY` turn yaw and pitch by the sensitivity. Pitch is clamped to ±`pitchLimitDeg`.
  - `blur` releases every key.
  - Losing the pointer lock while locked queues `pause`.
  - A refused `requestPointerLock`, whether it throws or returns a rejected promise, is caught and logs nothing (Review Focus 1).
- [ ] **Scene:**
  - A first-person camera at `eyeHeight`, FOV 75.
  - Floor tiles and walls. Racks as one `InstancedMesh`, with LED strips. Devices with their own look. Reuse `src/render/textures.ts`.
  - A red beacon over each broken rack, which turns green for 1.5 s on close. A blue marker on each unapplied patch target.
  - The renderer resizes on window resize and on DPR change.
  - Original low-poly geometry only.
- [ ] **HUD:**
  - shift clock `m:ss`;
  - one ticket card per open ticket: title, location, the runbook with the next step highlighted in `STEP_COLORS`, and an SLA bar that turns red after a breach;
  - the patch checklist;
  - a crosshair;
  - a floor map on a 2D canvas: racks, devices, the player and its facing, red broken racks, blue patch targets.
- [ ] **Rack panel:**
  - When `facingTarget` is a broken rack, the panel lists `PANEL_STEPS` with their keys and the rack's location. The `PIT` entry shows the ticket's `pitWork` text.
  - The panel highlights the picked step and shows the progress bar.
  - At a patch target it shows the patch name and the hold-E bar.
- [ ] **Screens:**
  - *Briefing:* the patch list, the controls table, and "Click to start".
  - *Pause:* Resume, Restart shift, Mouse sensitivity, and Back to start screen.
  - *Ended:* the ending headline, the shift report (the four stats and the patches), Play again, and Start screen.
  - Every option is a button that works with a click or with the keyboard.
- [ ] **Loop:**
  - The fixed step is 1/120 s with `MAX_CATCH_UP` 0.25 s, as in `src/game.ts`.
  - `visibilitychange` to hidden pauses the shift (Review Focus 4). `?seed=` seeds the shift.
  - The briefing click starts the shift and requests the pointer lock. The shift starts even if the lock is refused.
- [ ] Unit tests, lint and typecheck pass.
- [ ] Look at a screenshot from the dev server. Use headless Chromium; the e2e setup already has it.
- [ ] Commit `feat(shooter): first-person floor, HUD and screens`.

### Task 5: E2E, docs, version

**Files:**
- Create `e2e/shooter.spec.ts` and add it to the `chromium` and `webkit` projects.
- Modify `README.md`, `AGENTS.md`, `docs/changelog.md` and `package.json`.
- [ ] `shooter.spec.ts` with `?game=shooter&seed=1&debug=1`:
  - the briefing shows 3 patches;
  - `start()`, then `screen()` is `playing`;
  - holding W for 1 s moves `player()`;
  - `breakNow('r1', 'outdated-firmware')`, then `faceTarget('r1')`;
  - press 5 (FW-ISO) and hold E for 2.5 s, then press 4 (REINSTATE) and hold E for 2.5 s;
  - `openTickets()` is empty and `stats().ticketsClosed` is 1;
  - a wrong step raises `wrongSteps`;
  - P pauses and Resume returns to `playing`;
  - `setClockLeft(1)` → `ending()` is `'fired'` and the end screen shows;
  - a second test applies all 3 patches with `faceTarget` and hold E, then `setClockLeft(1)` → `'clean'`;
  - no `console.error` or `pageerror`;
  - record `renderInfo().calls` in the report.
- [ ] Run all Playwright projects locally and in the CI container under Colima: all pass.
- [ ] Docs:
  - README: the start screen, a shooter controls table, and the `?game=` links.
  - AGENTS.md: the layout gains `src/shooter/`, and the pure-logic rule names both folders.
  - `docs/changelog.md`: a `## 0.5.0` section.
  - Bump `package.json` to `0.5.0`.
- [ ] Full check (the AGENTS.md command) passes. Commit `feat: shooter e2e and docs; v0.5.0`.
