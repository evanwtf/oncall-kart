# Shooter phase 2 ("vendors and the money gun") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendors walk in from the loading dock and crowd the player. Each close vendor slows the player and the work bar. The money gun distracts them; budget is its ammo. Bills that miss become lures. A wrong step sets off an alarm that calls vendors. A toolkit pickup makes work faster.

**Architecture:**
- All rules stay pure in `src/shooter/logic/` and run inside `stepShift`, with a fixed step and seeded RNG.
- Vendors find their way with a flow field on a grid of the floor. A flow field is a BFS distance map from one goal, which every vendor follows downhill.
- The renderer and the HUD only read state and events.

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-11-05-oncall-shooter-design.md`, sections Vendors, The money gun, Fixing a server (alarm, toolkit), HUD. Phase 1 plan: `docs/superpowers/plans/2026-11-05-oncall-shooter-phase1.md`.

## Global Constraints

- **Earlier constraints:** every Global Constraint of the phase 1 plan still holds.
- **The slowdown (Evan's rule):** each vendor within close range takes 20 percentage points off your speed. Vendors stack, down to a floor of 10%. Speed depends only on how many vendors are close right now. A distracted vendor does not count. Speed comes back as soon as you get clear.
- **The slowdown applies to the work bar too** (spec, my call).
- **Vendors never trap the player.** The player passes through vendors at the slowed speed: there is no player-vendor collision.
- **No violence:** vendors are never hurt. A hit means they stop to pick up the money. The gun is a cartoon cash blower.
- **No real names:** vendors are job roles with no company names or logos, and no vendor looks like a real person.
- **Performance:** 60 fps on the weakest current MacBook Air with 20 vendors and 100 bills on screen. Draw calls stay under about 150.
- **Version:** `0.6.0` when this plan is done.

## Review Focus

1. **Vendors stuck on geometry.**
   - Vendors must not catch on rack corners, jam in the doorways between areas, or orbit a target they cannot reach.
   - Twenty vendors released at the dock must all reach the player in the break room.
   - A vendor that makes no progress for 3 s gets nudged free. It is never teleported in view.
2. **The slowdown, exactly.**
   - Factor = max(0.1, 1 - 0.2 × n), where n counts close vendors that are not distracted.
   - It scales both the top speed and the work rate.
   - At the 10% floor, work still moves forward: it never stops or runs backward.
   - The factor comes back on the first step after the vendors leave.
3. **Money edge cases.**
   - Firing while working does nothing.
   - Budget never goes below 0, and at 0 the gun clicks.
   - A hit on a vendor that is already distracted sets its timer to the larger of the time left and a fresh distraction.
   - One lure is picked up by exactly one vendor.
   - Lures expire. A PO pickup is not taken twice.
4. **Determinism.**
   - Vendors use their own RNG, derived from the seed. For a given seed, the phase 1 break times and broken racks stay the same.
   - The same seed and the same inputs give the same vendor positions after 60 s.
5. **Bounded cost.**
   - The flow field toward the player is rebuilt only when the player enters a new grid cell. Alarm fields are built once per alarm.
   - Nothing in `stepShift` allocates per vendor per step.
   - Pause and a hidden tab freeze the vendors.

---

### Task 1: Grid and flow field (pure, TDD)

**Files:** Create `src/shooter/logic/nav.ts`; test `tests/shooter/nav.test.ts`.

**Interfaces (Produces):**
```ts
export interface NavGrid { cell: number; cols: number; rows: number; open: Uint8Array }   // 1 = walkable for a vendor of radius r
export function buildNavGrid(floor: FloorDef, cell: number, radius: number): NavGrid;      // cell 0.5 m, radius TUNING.vendorRadius
export interface FlowField { goal: { x: number; z: number }; dist: Int32Array }            // -1 = unreachable
export function flowField(grid: NavGrid, gx: number, gz: number, into?: FlowField): FlowField;   // reuses `into` buffers
export function flowDir(grid: NavGrid, f: FlowField, x: number, z: number): { x: number; z: number };   // unit vector downhill (8-neighbour), {0,0} at goal
```
- [ ] Failing tests:
  - Every rack front point and the dock are open cells.
  - A cell inside a rack is closed.
  - From the dock, the field to the spawn point is finite.
  - Following `flowDir` at 3 m/s with `moveWithCollision`, from the dock and from 10 random open cells (seeded), reaches within 1 m of the spawn point in under 60 s. No walk stays stuck: 3 s without 0.2 m of progress counts as stuck.
  - `flowField(..., into)` returns the same object and allocates no new buffer.
  - One flow-field build on the real floor takes under 5 ms in Node. Print the time; assert under 20 ms so CI stays stable.
- [ ] Implement. PASS. Commit `feat(shooter): navigation grid and flow field`.

### Task 2: Vendors and the slowdown (pure, TDD)

**Files:**
- Create `src/shooter/logic/vendors.ts`.
- Modify `shift.ts`, `player.ts` (`stepPlayer` gains `speedScale = 1`) and `tuning.ts`.
- Test `tests/shooter/vendors.test.ts`.

**Interfaces (Produces):**
```ts
export type VendorRole = 'account-exec' | 'renewal-rep' | 'license-auditor' | 'support-agent' | 'solutions-architect';
export const VENDOR_ROLES: Record<VendorRole, { title: string; speed: number; distractScale: number; lines: readonly string[] }>;
//   account-exec fast (about 4.5 m/s); license-auditor slow (about 2.2 m/s), distractScale 0.4; others about 3 m/s, 1.0
export interface Vendor { id: number; role: VendorRole; x: number; z: number; distractedUntil: number;
  goal: 'player' | { alarm: string; until: number } | { lure: number }; stuckFor: number }
export function vendorArrivals(rng: Rng): { time: number; role: VendorRole }[];   // about 16 a shift, closer together later; first at about 15 s
export function slowFactor(closeCount: number): number;   // max(0.1, 1 - 0.2 * n)
export function closeVendors(s: Shift): number;           // not distracted, within TUNING.closeRange (2 m) of the player
// shift.ts additions
//   Shift gains: vendors: Vendor[]; vendorRng: Rng; arrivals; nav: NavGrid; playerField: FlowField; alarmFields: Map<string, FlowField>
//   ShiftStats gains: vendorsDistracted: number; moneySpent: number
//   ShiftEvent gains: { type: 'vendor-arrived'; id; role } | { type: 'vendor-close'; id; role; line: string }
```
- Vendor movement:
  - Vendors follow the flow field toward their goal, at the role's speed, with `moveWithCollision` against `s.boxes`.
  - They keep a gap of about 0.6 m from each other and from the player: they stand around you.
  - Inside 1 m of the player they stop walking.
  - At most `TUNING.maxVendors` (20) are on the floor. An arrival beyond that waits.
- Alarm: a `step-wrong` sends every vendor within `alarmRange` (30 m) to that rack for `alarmSeconds` (8 s).
- Slowdown: each step, `stepPlayer` gets `speedScale = slowFactor(closeVendors(s))`, and work progress adds `dt × slowFactor(...)`.
- `vendor-close` fires when a vendor enters close range, at most once per 3 s across all vendors, with a line from the role's list. The builder writes the lines: original, short, about the job.
- [ ] Failing tests:
  - `slowFactor`: 0 → 1, 1 → 0.8, 2 → 0.6, 3 → 0.4, 4 → 0.2, 5 → 0.1, 9 → 0.1.
  - A distracted vendor at 1 m does not count.
  - With 3 vendors at 1.5 m, the player's top speed is 0.4 × `runSpeed`, and an `opSeconds` step takes `opSeconds / 0.4`. When the vendors are moved to 10 m, the next step is at full rate.
  - With 6 vendors, work still finishes, in `opSeconds / 0.1`.
  - `vendorArrivals(makeRng(7))` is deterministic, ascending, gives the first arrival at 10-20 s and at least 12 arrivals, and the second half of the shift holds more arrivals than the first.
  - 20 vendors spawned at the dock all get within 2 m of a player standing at the spawn point in under 60 s, and none is stuck for more than 3 s (Review Focus 1).
  - A wrong step sends a vendor 20 m away to the rack. A vendor 40 m away keeps chasing the player.
  - The player walks through a ring of vendors: no collision.
  - Phase 1 behaviour holds: for seed 1, `schedule` and the first 3 broken rack ids equal a snapshot taken before this task (Review Focus 4).
  - Same seed and same inputs give the same vendor positions after 60 s.
- [ ] Implement. PASS. Commit `feat(shooter): vendors, alarms and the slowdown`.

### Task 3: Money gun, budget, lures, pickups (pure, TDD)

**Files:**
- Create `src/shooter/logic/money.ts`.
- Modify `shift.ts` and `tuning.ts`.
- Test `tests/shooter/money.test.ts`.

**Interfaces (Produces):**
```ts
export interface Bill { id: number; x: number; z: number; vx: number; vz: number; life: number }   // in flight
export interface Lure { id: number; x: number; z: number; until: number; takenBy: number | null }  // bills on the floor
export interface Pickup { id: number; kind: 'po' | 'toolkit'; x: number; z: number; respawnAt: number | null }
// Shift gains: budget: number; bills: Bill[]; lures: Lure[]; pickups: Pickup[]; toolkit: boolean; fireCooldown: number
// ShiftInput gains: fire: boolean   // mouse button held
// ShiftEvent gains: { type: 'fired' } | { type: 'dry-fire' } | { type: 'vendor-distracted'; id; role }
//   | { type: 'lure-dropped'; id } | { type: 'lure-taken'; id; vendorId } | { type: 'picked-up'; kind: 'po' | 'toolkit' }
```
- **Tuning (starting values; tune by feel):**

  | Name | Value | Meaning |
  | --- | --- | --- |
  | `startBudget` | 20000 | budget at the start of the shift |
  | `shotCost` | 500 | spent per shot |
  | `fireRate` | 4 | shots per second while the button is held |
  | `billsPerShot` | 3 | bills fired at once |
  | `spreadDeg` | 4 | spread of the bills |
  | `billSpeed` | 25 | m/s |
  | `billRange` | 14 | m |
  | `distractSeconds` | 5 | times the role's `distractScale` |
  | `lureSeconds` | 10 | a lure's life on the floor |
  | `lureRange` | 6 | m within which a vendor goes for a lure |
  | `pickupSeconds` | 2 | a vendor's time spent picking up a lure |
  | `poAmount` | 5000 | budget from one PO |
  | `poRespawn` | 30 | s before a PO comes back |
  | `toolkitScale` | 0.7 | step time multiplier with the toolkit |
- **Pickup positions:** 4 POs at fixed floor positions, one per area except the break room. One toolkit per shift, at a seeded position in a data hall. All are taken by walking over them (radius 0.8 m).
- **Bills:**
  - A bill that comes within `vendorRadius` + 0.1 m of a vendor distracts it and is removed. Several bills from one shot that hit the same vendor count as one hit.
  - A bill that hits a box or reaches its range lands as a lure. Bills from the same shot within 1 m of each other merge into one lure.
- **Lures:** a free vendor (not distracted, not alarmed) within `lureRange` of a free lure claims it (`takenBy`), walks to it, and is distracted for `pickupSeconds`. The lure is then removed.
- **Rules:** no fire while working. Budget is clamped at 0; at 0 the fire button gives `dry-fire`, at most 2 per second. `moneySpent` adds `shotCost` per shot; `vendorsDistracted` adds 1 per hit or lure taken.
- [ ] Failing tests:
  - A vendor 8 m dead ahead, after one shot: `vendor-distracted`, and that vendor does not count for `closeVendors` for `distractSeconds`.
  - A license auditor is distracted for `distractSeconds × 0.4`.
  - A second hit 1 s into a distraction sets the timer to max(time left, a fresh distraction).
  - A shot at a wall 5 m away gives a lure. A vendor 4 m from it takes it (`lure-taken`). A second vendor next to it does not take the same lure.
  - A lure that nobody takes is gone after `lureSeconds`.
  - Holding fire for 1 s fires 4 shots and spends 2000.
  - With a budget of 600: one shot leaves 100, then `dry-fire`, and the budget stays at 100.
  - Fire while working: no `fired` event, and the budget is unchanged.
  - Walking over a PO adds `poAmount`, and the PO comes back after `poRespawn`. Standing on it does not pay twice.
  - With the toolkit, an `opSeconds` step takes `opSeconds × 0.7`.
  - 100 bills in flight for 1 s, stepped at 1/120: no bill passes through a rack.
- [ ] Implement. PASS. Commit `feat(shooter): money gun, budget, lures and pickups`.

### Task 4: Render, HUD, input, report

**Files:**
- Modify `src/shooter/render/scene.ts` (or add `src/shooter/render/vendors.ts` and `props.ts`), `src/shooter/input.ts`, `src/shooter/ui/hud.ts`, `src/shooter/ui/screens.ts`, `src/shooter/game.ts` and `src/shooter/ui/shooter.css`.
- Tests in `tests/shooter/input.test.ts` and `tests/shooter/hud.test.ts`.
- [ ] **Vendors:**
  - Low-poly figures in business-casual clothes, each with a lanyard and a role prop: a clipboard, a laptop, a tablet, a slide-deck easel or a headset.
  - One colour per role. Use InstancedMesh per part, so draw calls do not grow with the vendor count.
  - A walk bob. A distracted vendor crouches to gather bills, with small "$" sprites over it.
  - A small role tag over each vendor within 8 m.
- [ ] **The gun:**
  - A cartoon cash blower held at the lower right of the view: a chunky plastic body with a bill hopper, in bright colours, nothing like a firearm.
  - A short kick when it fires. Bills in flight as instanced quads that flutter. Lures as small piles of bills.
- [ ] **Pickups:** a PO is a clipboard with a green "APPROVED" stamp, bobbing. The toolkit is a red tool case.
- [ ] **HUD:**
  - Budget as `$20,000`; it flashes red at 0.
  - When the factor is below 1: "Speed 40% · 3 vendors close".
  - The `vendor-close` line as a toast: "Account exec: Got five minutes?"
  - The floor map shows vendors as orange dots and POs as green dots.
  - The toolkit icon shows once it is taken.
- [ ] **Input:** the left mouse button held is `fire` while locked. While unlocked, a click asks for the lock and does not fire. Add a unit test.
- [ ] **Report:** the end screen adds "Vendors distracted" and "Money spent".
- [ ] **Hooks:**
  - always: `vendors(): { id; role; x; z; distracted: boolean }[]`, `budget()`, `speedFactor()`;
  - only with `?debug=1`: `spawnVendor(role, x, z)`, `setBudget(n)` and `fire(on: boolean)` (holds fire, as the mouse button does).
- [ ] Unit tests, lint and typecheck: clean. Take a screenshot with 6 or more vendors around a rack. Commit `feat(shooter): vendors, gun and HUD on screen`.

### Task 5: E2E, docs, version

**Files:**
- Modify `e2e/shooter.spec.ts`, `README.md`, `AGENTS.md` (only if the layout changed), `docs/changelog.md` and `package.json`.
- [ ] **E2E** in the chromium and webkit projects:
  - Vendors arrive: `vendors().length > 0` by 30 s. Use `setClockLeft` to move the clock forward if needed.
  - The slowdown: `spawnVendor` 3 at the player gives `speedFactor()` 0.4. `fire(true)` aimed at them with `faceTarget`-style aiming gives `budget()` < 20000, and `speedFactor()` returns to 1 within 2 s.
  - `setBudget(0)` then firing: the budget stays at 0, with no error.
  - The phase 1 tests still pass.
  - No console errors.
  - Record `renderInfo().calls` with 20 vendors.
- [ ] Run all Playwright projects locally and in the CI container under Colima: all pass.
- [ ] **Docs:**
  - README: the controls table gains the left click; a short "Vendors" section.
  - `docs/changelog.md`: a `## 0.6.0` section.
  - Bump the version to `0.6.0`.
- [ ] Full check passes. Commit `feat: vendors and the money gun e2e and docs; v0.6.0`.
