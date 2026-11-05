# oncall-kart phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven bot rivals, race positions, item boxes with five items, and three hazards: the full race from the design, minus sound (phase 3).

**Architecture:** Everything new in the game rules is pure logic in `src/logic/` and runs inside `stepRace`. Bot driving is a pure function from race state to `KartInput`, so bots and the player share one physics path. A single penalty function decides how every hit resolves (Firewall, then Rollback, then spin). The renderer and HUD only read state and events.

**Tech Stack:** unchanged (TypeScript, Vite, three.js, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-04-oncall-kart-design.md`, sections Items, Hazards, Bot rivals, Drivers, Race flow. Phase 1 plan: `docs/superpowers/plans/2026-11-04-oncall-kart-phase1.md`. Touch plan: `docs/superpowers/plans/2026-11-04-oncall-kart-touch.md` (it lands before this one).

## Global Constraints

- Every Global Constraint of the phase 1 plan still holds: original art and names only, no brand names, no runtime third-party requests, public-repo rules, no session IDs, `src/logic` never imports three or touches the DOM.
- The board reshuffles only when the **player** passes a row (design). Bots read the live board.
- Same seed, same inputs → same race. No `Math.random()` in `src/logic`; use `race.rng` (or a per-system RNG derived from the seed).
- The race must still hold 60 fps on the weakest current MacBook Air with 8 karts, items and hazards on screen. Keep draw calls under about 150.
- Version `0.3.0` when this plan is done.

## Review Focus

1. **Penalty order.** One hit meets Firewall first, then Rollback, then a spin. A blocked hit consumes the Firewall only. Two hits in one substep resolve one after the other. A kart that is already spinning is not hit again until the spin ends, so it cannot be stun-locked.
2. **A Page with no target** (the holder is in first place, or the kart ahead finished): it flies forward along the track and expires after `TUNING.pageLife` s. It never targets its own thrower.
3. **The race ends while karts are still racing.** The player finishes 5th: the results show the 4 finished bots in their finishing order, then the player, then the rest ranked by progress. Bots that finish after the player do not reorder the results already shown.
4. **Bots and the pit.** A bot whose next step is PIT takes the pit lane and the pit box, and leaves it again. It never gets stuck on the divider or loops in the pit lane. A bot stuck for `TUNING.stuckRespawn` s respawns like the player.
5. **Determinism across frame rates.** The same seed and the same player inputs, stepped at 30 fps and at 144 fps, give the same finishing order. Bots must not read wall-clock time.

---

### Task 1: Grid, ranking and kart-to-kart contact (closes #1)

**Files:** Modify `src/logic/race.ts`, `src/logic/lap.ts`; create `src/logic/contact.ts`; tests in `tests/race.test.ts`, `tests/lap.test.ts`, `tests/contact.test.ts`.

**Interfaces (Produces):**
```ts
// race.ts
export function gridSlot(index: number, track: Track): { s: number; lateral: number };   // 8 slots, 2 abreast, all after the line, inside gridS..gridS+40
export function standings(race: Race): number[];    // kart ids, best first: finished karts by finishedAt, then the rest by progress
// lap.ts: raceProgress handles a kart that has backed over the line (sector < 0 or completed lap undone)
// contact.ts
export function resolveContacts(karts: KartRuntime[]): void;   // circle push-apart, radius TUNING.kartRadius, mild speed exchange
```
- [ ] Failing tests: all 8 grid slots lie after the line and do not overlap; a kart that backs over the line ranks behind a kart that did not (issue #1); `standings` orders finished karts by `finishedAt`; two karts placed overlapping are separated after one step and neither passes through the other at a closing speed of 40 m/s. Implement. PASS. Commit `fix(logic): 8-kart grid, standings and kart contact (closes #1)`.

### Task 2: Bots

**Files:** Create `src/logic/bot.ts`; modify `src/logic/race.ts`, `src/logic/drivers.ts`, `src/logic/tuning.ts`; test `tests/bot.test.ts`.

**Interfaces (Produces):**
```ts
export interface BotProfile { topSpeedScale: number; lineNoise: number; wrongLaneChance: number; driftChance: number; itemDelay: number }
export const BOT_PROFILES: readonly BotProfile[];      // 7 profiles, from strong to weak
export function botInput(race: Race, kartId: number): KartInput;
// race.ts
export interface RaceConfig { laps: LapCount; seed: number; driverColor: number; bots: number }   // bots: 0..7, default 7
export interface KartRuntime { /* existing fields */ driverIndex: number; isBot: boolean; speedScale: number; item: ItemKind | null; rollbackArmed: boolean; shieldTime: number }
```
- Bot driving: aim at a point `TUNING.botLookahead` m ahead on the centerline, offset to the bot's lane. Within `TUNING.botGateLookahead` m of a gate row, steer to the slot of its next step. If the row has no slot for that step, steer to an open lane. With `wrongLaneChance`, pick a random slot instead (that is how a bot makes mistakes). Take the pit lane when the next step is PIT. Drift through corners sharper than a set curvature, with `driftChance`.
- Rubber-banding (bots only): `speedScale` moves toward 1.08 when the bot is far behind the player and toward 0.94 when it is far ahead, bounded by `TUNING.rubberBand`.
- The player's colour is removed from the bots' driver pool; each bot uses a distinct driver from `DRIVERS`.
- [ ] Failing tests: a race of 7 bots (no player input) over 3 laps finishes, every bot completes 3 laps within `3 × 70` s; across the field bots close at least 1 ticket per lap on average; a bot whose next step is PIT is served at the pit box; bots make some wrong gates (`wrongGates > 0` across the field over 10 laps) but the strongest makes fewer than the weakest; the same seed gives the same finishing order twice; Review Focus 4 and 5. Implement. PASS. Commit `feat(logic): seven bot rivals`.

### Task 3: Items, penalties and hazards

**Files:** Create `src/logic/items.ts`, `src/logic/hazards.ts`, `src/logic/penalty.ts`; modify `src/logic/race.ts`, `src/logic/kart.ts` (add `'ice'` to `Surface`), `src/logic/tracks/hall.ts`, `src/logic/tuning.ts`; tests `tests/items.test.ts`, `tests/hazards.test.ts`, `tests/penalty.test.ts`.

**Interfaces (Produces):**
```ts
// items.ts
export type ItemKind = 'coffee' | 'rollback' | 'firewall' | 'page' | 'spill';
export interface ItemBox { s: number; lateral: number; respawnAt: number }      // pickup radius TUNING.boxRadius
export interface Projectile { id: number; ownerId: number; targetId: number | null; s: number; lateral: number; speed: number; life: number }
export interface Puddle { id: number; ownerId: number; s: number; lateral: number; life: number }
export function rollItem(rng: Rng, place: number, field: number): ItemKind;      // trailing karts get more coffee and page; leaders more firewall and spill
export function useItem(race: Race, kartId: number): RaceEvent[];
// penalty.ts
export type HitKind = 'wrong-gate' | 'page' | 'spill' | 'cable' | 'cron';
export function applyHit(k: KartRuntime, kind: HitKind): 'blocked' | 'rolled-back' | 'spun';
// hazards.ts
export interface Hazard { kind: 'cable' | 'ice' | 'cron'; s: number; lateral: number; length: number; width: number; phase?: number }
export function cronPosition(h: Hazard, time: number, track: Track): { s: number; lateral: number };   // rolls across the road on a period
// race.ts: Race gains boxes, projectiles, puddles, hazards; RaceEvent gains
//   { type: 'item-picked'; kartId; item } | { type: 'item-used'; kartId; item } | { type: 'hit'; kartId; kind: HitKind; outcome: 'blocked' | 'rolled-back' | 'spun' }
```
- Item effects (design table): Coffee: `boostTime += TUNING.coffeeBoost`. Rollback: `rollbackArmed = true`. Firewall: `shieldTime = TUNING.shieldTime`. Page: a projectile that follows the track toward the next kart ahead in `standings`, at `TUNING.pageSpeed`, and hits it. Spill: a puddle `TUNING.spillOffset` m behind the thrower.
- `applyHit`: Firewall blocks page, spill, cable and cron hits while `shieldTime > 0`, then drops to 0. Otherwise an armed Rollback cancels any hit, wrong gates included, and disarms. Otherwise the kart spins for that kind's spin time. Route the existing wrong-gate penalty through `applyHit`.
- A ticket close also gives an item if the kart holds none.
- `HALL` gains 3 item-box rows (4 boxes each, not inside gate rows or the pit), 2 cable patches, 2 ice zones and 2 cron lanes. Ice is a surface: lower grip (`TUNING.iceGrip`) and a wider slide.
- [ ] Failing tests: pickup when inside the radius, box respawns after `TUNING.boxRespawn`, no pickup while holding an item; each item's effect; Review Focus 1 (order, single consumption, no stun-lock); Review Focus 2 (Page with no target); a Page hits only its target; a puddle disappears when hit; cron position is periodic and crosses the full road width; ice lowers grip; `rollItem` distribution shifts with place (1,000 rolls per place, first vs last). Implement. PASS. Commit `feat(logic): items, penalties and hazards`.

### Task 4: Render, HUD, controls and results

**Files:** Modify `src/render/scene.ts`, `src/render/kartMesh.ts`, `src/render/trackMesh.ts` (or a new `src/render/props.ts` for boxes, hazards, projectiles, puddles), `src/ui/hud.ts`, `src/ui/screens.ts`, `src/input.ts`, `src/touchInput.ts`, `src/game.ts`; e2e `e2e/smoke.spec.ts`, `e2e/touch.spec.ts`.

- [ ] **Karts:** 8 meshes, one per driver colour, with each driver's name on a small tag above the kart (fades with distance). Hit and spin animation; the Firewall shows as a translucent hex shell.
- [ ] **Props (original designs):**
  - item boxes are hazard-striped change-request crates that bob and spin;
  - a Page is a small pager with a blinking red light and a short trail;
  - a puddle is a brown disc with a paper cup;
  - cable spaghetti is a tangle of thin coloured tubes;
  - ice is a pale blue, frosted patch with a snowflake decal;
  - a cron job is a rolling barrel with a clock face.
  - Use InstancedMesh where there are many.
- [ ] **HUD:** the place (`3rd / 8`) with an animated change; the item slot (an icon and its name); a minimap (a 2D canvas of the track, top right under the ticket card, with a dot per kart in its colour, the player larger); toasts for hits ("PAGED BY <name>", "FIREWALL HELD", "ROLLED BACK").
- [ ] **Input:** Shift or E uses the item. Add an ITEM button to the touch layout, above DRIFT.
- [ ] **Results:** the finishing order of all 8 (Review Focus 3), then the player's shift report.
- [ ] **Setup:** the driver colour picker no longer offers a colour a bot uses; bots take the other 7.
- [ ] **E2E** (desktop and mobile projects): the race starts with 8 karts (`window.__oncallKart.kartCount() === 8`); `place()` returns 1..8; a debug hook `giveItem('coffee')` (only with `?debug=1`) and then the item key make `playerSpeed()` exceed `topSpeed`; no console errors. Record `renderInfo()` draw calls in the report.
- [ ] Full check, container run under Colima. Version `0.3.0`, `docs/changelog.md` section, README controls (item key, ITEM button). Commit `feat: bots, items and hazards on screen; v0.3.0`.
