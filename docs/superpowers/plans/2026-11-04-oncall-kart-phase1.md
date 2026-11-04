# oncall-kart phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One kart on the data-centre track with gates, tickets, a pit lane and laps (1/3/10), playable in Chrome and Safari and live on GitHub Pages.

**Architecture:** Pure TypeScript game logic in `src/logic/` (no three.js, no DOM), stepped at a fixed 1/120 s timestep and unit-tested in Node. A three.js renderer in `src/render/` and a DOM overlay in `src/ui/` read the logic state each frame. Vite builds static files under the `/oncall-kart/` base path; GitHub Actions on the self-hosted Linux runner checks, smoke-tests (Chromium + WebKit) and deploys to Pages.

**Tech Stack:** TypeScript 5 (strict), Vite 7, three.js (only runtime dependency), Vitest, Playwright, ESLint (flat config, typescript-eslint), Prettier, pre-commit.

**Spec:** `docs/superpowers/specs/2026-11-04-oncall-kart-design.md`. Read it first. Phase 1 builds everything in the spec except bots, items, item boxes, hazards and sound (phase 2 and 3).

## Global Constraints

- No Nintendo IP: the words "Mario" and "Mario Kart" appear nowhere; no bananas, shells, mushrooms, "?" boxes, copied tracks, music or logos.
- No real company, product or brand names anywhere in the game or repo.
- No runtime third-party requests: no CDN, no Google Fonts, no analytics. Fonts are system fonts.
- Public repo: no hostnames, LAN IPs (192.168.x, 172.16-31.x), private DNS suffixes, home-directory paths or 1Password item names in any file or commit.
- No Claude session URL, session ID, `Claude-Session:` or `Co-Authored-By: Claude` in any commit message or file.
- Desktop Chrome and Safari (macOS), keyboard only. WebGL 2 required; show a plain message if it is absent.
- Served from `https://evanwtf.github.io/oncall-kart/`: Vite `base: '/oncall-kart/'`.
- The version lives in `package.json` only and reaches the title screen through a Vite `define` (`__APP_VERSION__`). Start at `0.1.0`.
- CI runs on `runs-on: [self-hosted, Linux, X64]`. No `pull_request` trigger (push to `main` only, so fork PRs never reach the self-hosted runner).
- Artifacts uploaded by CI set `retention-days: 1`.
- Writing in docs and comments follows `~/git/baseline/conventions/writing.md`. US English.

## Review Focus

1. **Frame spikes** (tab switch, Safari throttling, a 2 s stall): `stepRace` clamps dt to 0.1 s and substeps at 1/120 s, so a kart never tunnels through a gate row, the finish line or a wall. Test in Task 5.
2. **Driving backwards** over the finish line or a gate row, or wiggling across it: a lap counts only after all sectors in order; a gate row triggers on a forward crossing only, once per pass. Tests in Task 3.
3. **A gate row or the pit near s = 0** (wrap-around of track distance): crossing math works across the seam. Test in Task 3.
4. **Keys held when the window loses focus**: input clears on `blur` and `visibilitychange`, so the kart does not drive itself. Test in Task 6.
5. **Restart, then restart again**: each race starts from a fresh state and the renderer does not stack listeners or meshes (doubled speed, doubled gates). Test in Task 5 (`createRace` twice gives equal state) and Task 7 (e2e restarts twice).

---

## File structure

```
index.html                    canvas + #ui overlay root
vite.config.ts                base path, __APP_VERSION__ define
package.json  package-lock.json  tsconfig.json  eslint.config.js  .prettierrc.json  .nvmrc (26)
playwright.config.ts          chromium + webkit projects, webServer = build + preview
src/main.ts                   WebGL 2 check, boot Game
src/game.ts                   rAF loop, fixed step, screen state, wiring logic <-> render <-> ui
src/input.ts                  keyboard -> KartInput + action queue
src/logic/vec.ts              Vec2 helpers
src/logic/rng.ts              seeded RNG
src/logic/ops.ts              operations
src/logic/runbooks.ts         ticket types (the data file people edit)
src/logic/ticket.ts           ticket lifecycle
src/logic/tuning.ts           every tunable number
src/logic/track.ts            centerline geometry, projection
src/logic/tracks/hall.ts      the data-centre hall track definition
src/logic/lap.ts              lap and sector tracking
src/logic/board.ts            gate rows, crossing, reshuffle
src/logic/kart.ts             arcade kart physics, drift, walls, surfaces
src/logic/race.ts             race state machine, events
src/render/scene.ts           renderer, lights, fog, resize, dispose
src/render/hall.ts            floor, racks (InstancedMesh), cable trays, dock
src/render/trackMesh.ts       road ribbon, kerbs, finish line, pit lane, divider
src/render/gates.ts           gate arches with canvas-texture labels
src/render/kartMesh.ts        kart + driver figure
src/render/camera.ts          chase camera
src/render/sparks.ts          drift sparks
src/ui/screens.ts             title, setup, countdown, pause, results, no-WebGL
src/ui/hud.ts                 lap, time, ticket card, SLA bar, toasts
src/ui/style.css
tests/*.test.ts               mirrors src/logic module names; plus scripts and ci tests
e2e/smoke.spec.ts
scripts/check-public.mjs      public-repo guard
scripts/refuse-session-ids.mjs commit-msg guard
.github/workflows/ci.yml
.pre-commit-config.yaml  .gitignore  .editorconfig
AGENTS.md (+ CLAUDE.md, GEMINI.md symlinks)  README.md  LICENSE (exists)
docs/plan.md  docs/changelog.md
```

---

### Task 1: Scaffold, guards, CI and Pages deploy

**Files:** everything in the tree above except `src/logic/*` (beyond an empty `src/logic/.gitkeep`), `src/render/*`, `src/ui/*`, `src/game.ts`, `src/input.ts`. `src/main.ts` renders a placeholder: "oncall-kart v<version>: coming soon".

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `test` (vitest run), `typecheck` (`tsc --noEmit`), `lint` (eslint .), `format` / `format:check` (prettier), `e2e` (playwright test); global `declare const __APP_VERSION__: string`.

- [ ] **Step 1:** `npm init`, install dev deps at their latest versions: `vite typescript three @types/three vitest @playwright/test eslint typescript-eslint @eslint/js prettier eslint-config-prettier globals`. three is a `dependency`; the rest are `devDependencies`. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `module: ESNext`, `moduleResolution: bundler`, `target: ES2022`, `lib: [ES2022, DOM, DOM.Iterable]`.
- [ ] **Step 2: Write the failing guard tests** in `tests/check-public.test.ts` and `tests/refuse-session-ids.test.ts`. Each guard exports a pure function and has a CLI wrapper:
  - `findPublicLeaks(text: string): string[]` flags `192.168.1.5`, `172.20.0.1`, `foo.internal`, `bar.lan`, `x.home.arpa`, `/Users/alice/`, `/home/bob/`; returns `[]` for `10.0.0.1` (baseline allows 10.x), `127.0.0.1`, `evanwtf.github.io`, `r12-u07`.
  - `findSessionIds(msg: string): string[]` flags `claude.ai/code/session_abc`, `Claude-Session: x`, `session_01ABC`, `Co-Authored-By: Claude <noreply@anthropic.com>`; returns `[]` for `fix: session timer drift`.
  - Run `npx vitest run tests/check-public.test.ts tests/refuse-session-ids.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement both in `scripts/*.mjs` with JSDoc types (tests import them). `check-public.mjs` CLI scans `git ls-files` (skipping itself and its test), prints `file:line` only, exits 1 on a match. `refuse-session-ids.mjs <msgfile>` exits 1 on a match. Run the tests: PASS.
- [ ] **Step 4:** `vite.config.ts` with `base: '/oncall-kart/'` and `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`. `npm run build` produces `dist/index.html` whose asset URLs start with `/oncall-kart/`.
- [ ] **Step 5: CI** `.github/workflows/ci.yml`, triggers `push: branches: [main]` and `workflow_dispatch`. Read `~/git/baseline/conventions/ci.md` first. Look up the current major tag of each action (`gh api repos/actions/<name>/releases/latest --jq .tag_name`) and use it.
  - Job `check` on `[self-hosted, Linux, X64]`: first step writes `npm_config_cache=$RUNNER_TEMP/npm-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT` to `$GITHUB_ENV` (shared runner, same reason as baseline's uv cache rule); `actions/setup-node` with `node-version-file: .nvmrc` and no `cache:`; `npm ci`; one step that collects the status of `npm run format:check` and `npm run lint`; `npm run typecheck`; `npm test`; `node scripts/check-public.mjs`; `npm run build`.
  - Job `e2e` on the same runner with `container: mcr.microsoft.com/playwright:v<X>-noble`, where `<X>` equals the installed `@playwright/test` version: `npm ci`, `npx playwright test`. On failure upload `playwright-report/` with `retention-days: 1`.
  - Job `deploy`: `needs: [check, e2e]`, `if: github.ref == 'refs/heads/main'`, `permissions: { pages: write, id-token: write }`, `environment: github-pages`, `concurrency: { group: pages, cancel-in-progress: false }`: build, `actions/upload-pages-artifact` (`path: dist`, `retention-days: 1`), `actions/deploy-pages`.
- [ ] **Step 6: Pin the Playwright versions equal.** `tests/ci.test.ts`: reads `.github/workflows/ci.yml` and `node_modules/@playwright/test/package.json`; asserts the container tag `v<version>-noble` matches. Run: PASS.
- [ ] **Step 7: e2e placeholder** `e2e/smoke.spec.ts`: page at `/oncall-kart/` shows text containing `oncall-kart v0.1.0`; no `console.error` and no `pageerror`. `playwright.config.ts`: projects `chromium` and `webkit`, `webServer: { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173/oncall-kart/' }`. Run locally `npx playwright test`: both PASS. Then run the same inside the CI image under Colima: `docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v<X>-noble sh -c 'npm ci && npx playwright test'`: both PASS. (This proves the container works before CI.)
- [ ] **Step 8: Pre-commit** `.pre-commit-config.yaml` (read `~/git/baseline/conventions/pre-commit.md`): `pre-commit-hooks` (check-added-large-files, check-merge-conflict, check-yaml, end-of-file-fixer, trailing-whitespace, detect-private-key), `gitleaks`, and local hooks: `node scripts/check-public.mjs`, `npm run lint`, `npm run typecheck` (`pass_filenames: false`), and a `commit-msg` stage hook running `node scripts/refuse-session-ids.mjs`. Install with `uvx pre-commit install --hook-type pre-commit --hook-type commit-msg`. Run `uvx pre-commit run --all-files`: PASS.
- [ ] **Step 9: Docs.** `AGENTS.md` (symlinks `CLAUDE.md`, `GEMINI.md`), tool-neutral, with: what the repo is; commands; the logic/render split rule ("`src/logic` never imports three or touches the DOM"); "every push to `main` deploys the live site"; delivery per baseline D1 (push to `main`); the four baseline policies verbatim (`~/git/baseline/conventions/agents-md.md`); one-line statements of the public-repo, no-session-ID and no-Nintendo-IP rules, each with its baseline link; a reading table. `README.md`: Bootstrap first (clone, `npm ci`, `npm run dev`, open the printed URL), then the live URL, controls table, how to edit `src/logic/runbooks.ts`. Run every README command before committing it. `docs/plan.md`: phases 1-3 from the spec. `docs/changelog.md`: `## 0.1.0` section.
- [ ] **Step 10:** Commit (`chore: scaffold, guards, CI and Pages deploy`). **Stop and report to the lead.** The lead pushes this commit to prove CI and Pages before Task 2.

### Task 2: Operations, runbooks and tickets

**Files:** Create `src/logic/{vec,rng,ops,runbooks,ticket,tuning}.ts`; tests `tests/{rng,runbooks,ticket}.test.ts`.

**Interfaces (Produces):**
```ts
// vec.ts
export interface Vec2 { x: number; z: number }
// rng.ts
export type Rng = () => number;                     // [0, 1)
export function makeRng(seed: number): Rng;         // mulberry32
export function pick<T>(rng: Rng, items: readonly T[]): T;
export function shuffle<T>(rng: Rng, items: readonly T[]): T[];   // new array
// ops.ts
export const OPS: readonly ['MAINT','TAKEDOWN','POWERON','REINSTATE','FW-ISO','LOGCOLLECT','META-SYNC','REIMAGE'];
export type Op = (typeof OPS)[number];
export type Step = Op | 'PIT';
export const OP_INFO: Record<Op, string>;           // meanings, verbatim from the spec table
// runbooks.ts
export interface TicketType { id: string; title: string; steps: readonly Step[]; pitWork?: string }
export const TICKET_TYPES: readonly TicketType[];
// ticket.ts
export interface Ticket { number: number; type: TicketType; location: string; stepIndex: number; issuedAt: number; deadline: number }
export type StepResult = 'advanced' | 'closed' | 'wrong';
export function issueTicket(rng: Rng, number: number, now: number): Ticket;
export function nextStep(t: Ticket): Step | null;   // null when closed
export function applyStep(t: Ticket, step: Step): { ticket: Ticket; result: StepResult };  // pure
// tuning.ts
export const TUNING: { /* every number in Tasks 2-5 */ };
export function slaSeconds(type: TicketType): number;
```

- [ ] **Step 1: Failing tests.**
  - `rng`: `makeRng(42)` gives the same first 5 values twice; values in `[0,1)`; `shuffle` keeps the multiset.
  - `runbooks`: exactly these 9 ids and step lists (copy the spec table): `failed-disk` TAKEDOWN,PIT,REINSTATE · `outdated-firmware` FW-ISO,REINSTATE · `bad-cpu` LOGCOLLECT,TAKEDOWN,PIT,POWERON,META-SYNC,REINSTATE · `switch-maintenance` MAINT,PIT,META-SYNC,REINSTATE · `rebuild-cluster` MAINT,REIMAGE,META-SYNC,REINSTATE · `overheating-gpu` LOGCOLLECT,TAKEDOWN,PIT,REINSTATE · `bad-dimm` LOGCOLLECT,TAKEDOWN,PIT,REINSTATE · `flapping-nic` MAINT,FW-ISO,META-SYNC,REINSTATE · `wrong-hostname` META-SYNC. Every type with a `PIT` step has `pitWork` (e.g. "swap the disk"). Every step is in `OPS` or is `PIT`.
  - `ticket`: `applyStep` with the next step → `advanced` and `stepIndex + 1`; with the last step → `closed`, `nextStep` null; with any other step → `wrong`, `stepIndex` unchanged; input ticket is not mutated. `location` matches `/^r([1-9]|[1-3]\d|40)-u(0[1-9]|[1-3]\d|4[0-2])$/`. `deadline === issuedAt + slaSeconds(type)`. `slaSeconds` grows with step count.
  - Run `npx vitest run tests/rng.test.ts tests/runbooks.test.ts tests/ticket.test.ts`: FAIL.
- [ ] **Step 2:** Implement. `slaSeconds` default: `25 + 14 * steps.length` (tune in Task 7 so a typical ticket needs about 1.5 laps).
- [ ] **Step 3:** Run the tests: PASS. `npm run typecheck && npm run lint`: clean.
- [ ] **Step 4:** Commit `feat(logic): operations, runbooks and tickets`.

### Task 3: Track geometry, laps and the gate board

**Files:** Create `src/logic/{track,lap,board}.ts`, `src/logic/tracks/hall.ts`; tests `tests/{track,lap,board}.test.ts`.

**Interfaces:**
- Consumes: `Vec2`, `Rng`, `shuffle`, `OPS`, `Op` (Task 2).
- Produces:
```ts
// track.ts   s = metres along the centerline, in [0, length); lateral > 0 = left of travel direction
export interface PitDef { startS: number; endS: number; side: 1 | -1; centerOffset: number; halfWidth: number; entryLen: number; exitLen: number }
export interface TrackDef { name: string; controlPoints: readonly Vec2[]; halfWidth: number; gateRowFractions: readonly number[]; sectorCount: number; pit: PitDef; gridS: number }
export interface Projection { s: number; lateral: number }
export interface Track { def: TrackDef; length: number; pointAt(s: number): Vec2; tangentAt(s: number): Vec2; project(p: Vec2, hintS?: number): Projection }
export function buildTrack(def: TrackDef, samples?: number): Track;  // closed Catmull-Rom, arc-length table
export function wrapS(s: number, length: number): number;
export function forwardDelta(prevS: number, curS: number, length: number): number;  // signed, shortest way round
export function crossedForward(markS: number, prevS: number, curS: number, length: number): boolean;
// tracks/hall.ts
export const HALL: TrackDef;      // 6 gate rows, 4 sectors, pit on the main straight, lap ≈ 40-60 s at average pace
// lap.ts
export interface LapState { completed: number; sector: number; lapStartTime: number; bestLap: number | null }
export function lapStart(now: number): LapState;
export function lapUpdate(state: LapState, prevS: number, curS: number, track: Track, now: number): { state: LapState; completedLap: boolean };
export function raceProgress(state: LapState, s: number, length: number): number;  // completed + s/length
// board.ts
export interface GateSlot { lateral: number; halfWidth: number; op: Op }
export interface GateRow { s: number; slots: GateSlot[] }
export type Board = GateRow[];
export function createBoard(rng: Rng, track: Track): Board;
export function slotAt(row: GateRow, lateral: number): GateSlot | null;
export function reshuffleAfterPass(board: Board, passedRow: number, rng: Rng): Board;   // new board
```

- [ ] **Step 1: Failing tests.**
  - `track`: a circle of radius 50 built from 16 control points has `length` within 1% of `2π·50`; `project(pointAt(s))` returns `s` within 0.5 m and `lateral` ≈ 0; a point 3 m left of travel gives `lateral` ≈ +3; `wrapS(-1, 100) === 99`; `forwardDelta(99, 1, 100) === 2`, `forwardDelta(1, 99, 100) === -2`; `crossedForward(0, 99, 1, 100)` true, `crossedForward(0, 1, 99, 100)` false, `crossedForward(50, 40, 60, 100)` true.
  - `lap` (Review Focus 2, 3): with `sectorCount` 4 on a 100 m track and `gridS` = 2, driving forward from s=2 all the way round completes 1 lap; driving forward over the line, back over it and forward again completes 0 laps; driving backward from 2 to 98 and forward again completes 0 laps; `bestLap` holds the shortest lap time.
  - `board`: `createBoard` gives one row per `gateRowFractions` entry, 2 or 3 slots per row, slots inside `halfWidth` and not overlapping, every `Op` at least once; `slotAt` returns the slot under a lateral and `null` in an open lane; `reshuffleAfterPass` keeps the multiset of ops, keeps every op present, leaves row `passedRow + 1` (mod rows) unchanged, changes row `passedRow` for at least 95 of 100 seeds; a gate row at s = 0.5 m is crossed by a move from s = length − 1 to s = 2 (Review Focus 3).
  - Run: FAIL.
- [ ] **Step 2:** Implement. Reshuffle algorithm: for each slot in `passedRow`, swap its op with a slot chosen at random from rows other than `passedRow` and `passedRow + 1`. Lap rule: sectors are equal-length spans; `sector` advances only on a forward crossing of the next sector boundary in order; crossing the line forward with `sector === sectorCount - 1` completes the lap; any backward crossing of a boundary moves `sector` back.
- [ ] **Step 3:** Design `HALL`: a closed loop of about 600-800 m with a long main straight (the loading dock) holding the finish line, the grid and the pit; at least one hairpin and one fast sweeper; `halfWidth` about 9 m. Add a test that `HALL` builds, its rows are at least 60 m apart, no row lies within the pit span, and `gridS` is 5-30 m after the line.
- [ ] **Step 4:** Run the tests: PASS. Typecheck and lint clean. Commit `feat(logic): track geometry, laps and gate board`.

### Task 4: Kart physics

**Files:** Create `src/logic/kart.ts`; test `tests/kart.test.ts`. Extend `tuning.ts`.

**Interfaces:**
- Consumes: `Vec2`, `Track`, `Projection`, `TUNING`.
- Produces:
```ts
export interface KartInput { throttle: number; brake: number; steer: number; drift: boolean }   // steer: -1 right … +1 left
export const NO_INPUT: KartInput;
export interface KartState { pos: Vec2; heading: number; speed: number; driftDir: -1 | 0 | 1; driftTime: number; boostTime: number; spinTime: number; holdTime: number; slowTime: number }
export type Surface = 'road' | 'offroad' | 'pit';
export function spawnKart(track: Track, s: number, lateral: number): KartState;   // facing travel direction, speed 0
export function stepKart(k: KartState, input: KartInput, dt: number, surface: Surface): KartState;
export function driftStage(driftTime: number): 0 | 1 | 2 | 3;
export function surfaceAt(p: Projection, track: Track): Surface;
export function constrainToTrack(k: KartState, p: Projection, track: Track): KartState;
```
`heading` in radians; forward vector `(sin h, cos h)` in (x, z).

- [ ] **Step 1: Failing tests.** From rest with full throttle on `road`, speed rises and settles at `TUNING.topSpeed` (±1%) and never above it without boost; on `offroad` it settles at `TUNING.offroadTopSpeed`; on `pit` it never exceeds `TUNING.pitSpeedLimit`; brake to a stop, then reverse to at most `TUNING.reverseSpeed`; with `spinTime > 0` input is ignored and speed decays; with `holdTime > 0` the kart stays put; drift held while steering for `TUNING.driftStages[1]` then released gives `boostTime === TUNING.driftBoost[1]`, and stage 3 gives the longest boost; releasing drift before stage 1 gives no boost; a drift starts only above `TUNING.driftMinSpeed`; boosted speed exceeds `topSpeed` while `boostTime > 0`; `slowTime > 0` caps speed at `TUNING.slowFactor * topSpeed`. `constrainToTrack`: a kart 2 m past the outer edge is pushed back inside and loses at least 30% speed; a kart in the pit lane span on the pit side stays; the divider between road and pit lane is a wall except at the entry and exit openings. `surfaceAt`: centre → `road`, beyond `halfWidth` → `offroad`, inside the pit lane → `pit`.
- [ ] **Step 2:** Implement. Arcade model, no physics library: speed along heading, yaw rate proportional to `steer` scaled down at high speed, drift raises yaw rate and adds an outward slide, friction and drag terms from `TUNING`.
- [ ] **Step 3:** Tests PASS; typecheck and lint clean. Commit `feat(logic): arcade kart physics with drift and walls`.

### Task 5: Race state machine

**Files:** Create `src/logic/race.ts`; test `tests/race.test.ts`.

**Interfaces:**
- Consumes: everything from Tasks 2-4.
- Produces:
```ts
export type LapCount = 1 | 3 | 10;
export interface RaceConfig { laps: LapCount; seed: number; driverColor: number }
export interface KartStats { ticketsClosed: number; wrongGates: number; slaBreaches: number }
export interface KartRuntime { id: number; kart: KartState; proj: Projection; lap: LapState; ticket: Ticket; stats: KartStats; finishedAt: number | null; pitServedTicket: number | null; offroadTime: number; stuckTime: number }
export type RaceEvent =
  | { type: 'step-ok'; kartId: number; step: Step }
  | { type: 'ticket-closed'; kartId: number; ticket: Ticket }
  | { type: 'ticket-issued'; kartId: number; ticket: Ticket }
  | { type: 'wrong-gate'; kartId: number; op: Op }
  | { type: 'sla-breach'; kartId: number; ticket: Ticket }
  | { type: 'pit-service'; kartId: number; work: string }
  | { type: 'lap'; kartId: number; completed: number; lapTime: number }
  | { type: 'board-reshuffled'; row: number }
  | { type: 'respawn'; kartId: number }
  | { type: 'go' }
  | { type: 'finished'; kartId: number; time: number };
export type RacePhase = 'countdown' | 'racing' | 'finished';
export interface Race { config: RaceConfig; track: Track; board: Board; rng: Rng; time: number; countdown: number; phase: RacePhase; karts: KartRuntime[]; playerId: 0; nextTicketNumber: number }
export function createRace(config: RaceConfig, track: Track): Race;
export function stepRace(race: Race, inputs: readonly KartInput[], dt: number): RaceEvent[];   // mutates race
export function respawn(race: Race, kartId: number): RaceEvent[];
```
Phase 1 has one kart (`karts.length === 1`), but every loop runs over `karts`, so phase 2 adds bots without changing the shape.

- [ ] **Step 1: Failing tests.**
  - `createRace` twice with the same config gives deep-equal state except `rng` (Review Focus 5); countdown is 3 s; inputs are ignored until `go`.
  - Gates: a kart driven forward through the slot whose op is its `nextStep` emits `step-ok`; through another slot emits `wrong-gate` and sets `spinTime === TUNING.wrongGateSpin` (spin is the time penalty); through an open lane emits nothing; driving through the last step emits `ticket-closed`, sets `boostTime === TUNING.ticketCloseBoost`, then `ticket-issued` with `number` + 1. The player passing row `i` emits `board-reshuffled` for row `i`.
  - Pit: entering the pit lane while `nextStep === 'PIT'` sets `holdTime === TUNING.pitHold`, emits `pit-service` with the type's `pitWork`, and advances the ticket once per ticket (`pitServedTicket`); entering when the next step is not `PIT` changes nothing but the speed limit.
  - SLA: when `time > ticket.deadline` emit `sla-breach`, set `slowTime === TUNING.slaSlow`, issue a new ticket, increment `slaBreaches`.
  - Laps: a scripted driver (steer toward `pointAt(s + 15)`, full throttle) finishes a 1-lap race: `finished` event, `phase === 'finished'`, `finishedAt` set; with `laps: 3` it emits 3 `lap` events.
  - Frame spikes (Review Focus 1): `stepRace(race, inputs, 2.0)` advances `time` by 0.1 only; a kart at speed crossing a gate row in one big step still triggers the gate (substeps of 1/120 s).
  - Respawn: `respawn` puts the kart on the centerline at its current `s`, speed 0, `holdTime === TUNING.respawnHold`; auto-respawn after `TUNING.offroadRespawn` s off-road or `TUNING.stuckRespawn` s stuck under throttle.
  - Run: FAIL.
- [ ] **Step 2:** Implement. Per substep: step each kart, project (`hintS` = last `s`), constrain, detect crossings with `prevS`/`curS`, update laps, check SLA and auto-respawn.
- [ ] **Step 3:** Tests PASS; typecheck and lint clean. Commit `feat(logic): race state machine with tickets, gates, pit and laps`.

### Task 6: Renderer, input and game loop

**Files:** Create `src/render/*.ts`, `src/input.ts`, `src/game.ts`; modify `src/main.ts`; test `tests/input.test.ts` (Vitest `environment: 'jsdom'` for this file only; add `jsdom` as a dev dependency).

**Interfaces:**
- Consumes: `Race`, `RaceEvent`, `Track`, `Board`, `KartInput`, `stepRace`, `createRace`, `respawn`.
- Produces:
```ts
// input.ts
export type Action = 'confirm' | 'back' | 'pause' | 'respawn' | 'up' | 'down' | 'left' | 'right';
export interface Keyboard { read(): KartInput; takeActions(): Action[]; dispose(): void }
export function createKeyboard(target: Window): Keyboard;
// render/scene.ts
export interface SceneHandle { render(race: Race, alpha: number): void; onEvents(events: RaceEvent[]): void; resize(): void; dispose(): void }
export function createScene(canvas: HTMLCanvasElement, race: Race): SceneHandle;
// game.ts
export function startGame(canvas: HTMLCanvasElement, uiRoot: HTMLElement): void;
```
- [ ] **Step 1: Failing input tests** (Review Focus 4): ArrowUp or W down → `throttle 1`; Left/A → `steer +1`; Space → `drift true`; a `blur` on the window clears all held keys; `visibilitychange` to hidden clears them; Enter → `confirm` action once (no repeat while held); `P` and `Escape` → `pause`; `R` → `respawn`; `dispose` removes listeners (a later keydown changes nothing). Run: FAIL. Implement. Run: PASS.
- [ ] **Step 2: Scene** (no unit tests; checked in Task 7 e2e). `WebGLRenderer` with `antialias`, pixel ratio `min(devicePixelRatio, 2)`, resize on `resize`. Hemisphere light plus one directional light, one shadow map at most. Fog for depth. Art direction: cold-aisle blue light, raised floor tiles, rack rows as `InstancedMesh` with blinking emissive LEDs, cable trays overhead, a loading-dock straight, hazard-stripe kerbs, a chequered finish line in on-call colours (not black-and-white flag art copied from anywhere: any original pattern works). Gate arches carry `CanvasTexture` labels and redraw only the rows named in `board-reshuffled`. The kart is a small low-poly cart with a hoodie-and-headset driver in the chosen colour. The chase camera lerps behind and above, widens FOV slightly during boost. Drift sparks: `Points`, colours white → amber → cyan by stage. `dispose` frees geometries, materials, textures and listeners.
- [ ] **Step 3: Game loop.** `requestAnimationFrame`; accumulate time and call `stepRace` at 1/120 s; `render(race, alpha)` interpolates. Pause on `pause` action and when the tab hides. `?seed=<n>` sets the seed; default is random. Expose `window.__oncallKart = { version, phase(), screen(), playerSpeed(), playerLap(), playerTicket() }` for e2e.
- [ ] **Step 4:** `npm run dev`, drive a lap by hand in Chrome and Safari. Report frame rate (Chrome DevTools FPS meter or `renderer.info`) and anything that felt wrong.
- [ ] **Step 5:** Typecheck, lint, unit tests clean. Commit `feat: three.js renderer, keyboard input and game loop`.

### Task 7: Screens, HUD, smoke tests and tuning

**Files:** Create `src/ui/{screens,hud}.ts`, `src/ui/style.css`; modify `src/game.ts`, `e2e/smoke.spec.ts`, `src/logic/tuning.ts`, `docs/changelog.md`, `README.md`.

**Interfaces:**
- Consumes: `startGame`, `Race`, `RaceEvent`, `Keyboard` actions.
- Produces: screens `title → setup → countdown → racing ⇄ paused → results → (restart | setup)`; `window.__oncallKart.screen()` returns that name.

- [ ] **Step 1: Screens and HUD.** Title: game name, version, "Press Enter". Setup: laps 1 / 3 / 10 (left/right), 8 driver colours (up/down), Enter to start. HUD: `LAP n/N`, race time, best lap, the ticket card (`#<number> <title> <location>`, steps with done / next / pending marks, the pit step shows its `pitWork`), an SLA bar that turns red under 20%, toasts for events ("NOT IN THE RUNBOOK", "TICKET CLOSED: BOOST", "PAGED: SLA BREACH", "PIT: <work>", "CHANGE BOARD MOVED" is quiet, no toast). Results: finish time, best lap, tickets closed, wrong gates, SLA breaches, a one-line shift-report caption; Enter restarts, Escape goes to setup. Pause overlay: Resume, Restart, Quit to setup. No-WebGL screen: "oncall-kart needs WebGL 2. Try current Chrome or Safari." System font stack only.
- [ ] **Step 2: Smoke tests** in `e2e/smoke.spec.ts`, run on `chromium` and `webkit`, with `?seed=1`:
  - title shows `v0.1.0`; Enter → setup; Enter → countdown; within 6 s `screen()` is `racing`;
  - hold ArrowUp 2 s → `playerSpeed() > 5`;
  - the canvas has a WebGL 2 context;
  - P → `paused`, P → `racing`;
  - Escape → pause → Restart, twice; after the second restart, hold ArrowUp 2 s and `playerSpeed()` is no more than `TUNING.topSpeed` (Review Focus 5);
  - resize the viewport to 800×600 and back: no errors;
  - no `console.error` or `pageerror` in the whole run.
  - Chromium in the container needs software WebGL: launch args `--use-angle=swiftshader --enable-unsafe-swiftshader`. Run locally (macOS) and in the CI container under Colima. **If WebKit cannot create a WebGL 2 context in the Linux container**, move the WebKit project to a separate job on `[self-hosted, macOS, ARM64]` (native WebKit on macOS) and report this.
- [ ] **Step 3: Tuning pass.** Play 1-lap and 3-lap races. Target: a lap of 40-60 s at average pace; a typical 4-step ticket closes in about 1.5 laps; a wrong gate costs about 1 s; the pit costs about 3 s in total. Adjust `TUNING` only; record the final numbers in the commit message.
- [ ] **Step 4:** Update `docs/changelog.md` (`## 0.1.0`: what shipped) and the README controls table. Run the full check: `npm run format:check && npm run lint && npm run typecheck && npm test && node scripts/check-public.mjs && npm run build && npx playwright test`: all PASS.
- [ ] **Step 5:** Commit `feat: screens, HUD and smoke tests; phase 1 tuning`. Report to the lead.
