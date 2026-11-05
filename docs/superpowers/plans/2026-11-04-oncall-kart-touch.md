# oncall-kart touch controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game playable on a phone or tablet (iOS Safari, Android Chrome) with on-screen controls. Desktop behaviour stays the same.

**Why:** Evan, 2026-11-04: "V1 can be desktop-only. Once that's working, add on-screen controls for mobile play."

**Architecture:** A second input source, `createTouch`, has the same shape as `createKeyboard` (`read(): KartInput`, `takeActions(): Action[]`, `dispose()`). `createInput` merges both. The DOM controls live in `src/ui/touch.ts`. Menus become tappable for touch and mouse alike. The mapping from finger position to steering is a pure function with unit tests.

**Spec:** `docs/superpowers/specs/2026-11-04-oncall-kart-design.md` (the touch non-goal is lifted by Evan's update in it). Phase 1 plan: `docs/superpowers/plans/2026-11-04-oncall-kart-phase1.md`.

## Global Constraints

- Every constraint in the phase 1 plan's "Global Constraints" still holds.
- Desktop with a fine pointer shows no touch controls. Keyboard play is unchanged; existing e2e tests stay green.
- Touch controls show when `matchMedia('(pointer: coarse)').matches`, or after the first `pointerdown` with `pointerType === 'touch'`.
- Pointer Events only (no legacy `touchstart` handlers except to block iOS gestures). Multi-touch: track each `pointerId` separately, so steering and drift work at the same time.
- No new runtime dependency.

## Control layout (my call; tune by feel)

Landscape, thumbs at the bottom corners, inside the safe-area insets:

- **Left half of the screen: steering pad.** The touch-down point is the centre; horizontal drag sets `steer` (−1 right … +1 left, same sign as the keyboard). Dead zone 8 px; full lock at 70 px. A faint ring and knob show where the thumb is.
- **Right side: three buttons.** DRIFT (large, hold), BRAKE (hold; reverse when stopped), and GAS.
- **Auto-gas:** on by default for touch. `throttle` is 1 unless BRAKE is held. A GAS toggle in the pause menu turns auto-gas off; then GAS is a hold button. Remember the choice in `localStorage` (wrapped in try/catch).
- **Top right: pause button** (≥ 44 px target). It maps to `pause`.
- **Respawn:** a button in the pause menu (touch has no R key).
- Menus: every option on title, setup, pause and results is a tap target ≥ 44 px. Tapping an option selects it; tapping the selected one (or a Start button) confirms. Mouse clicks work the same way on desktop.
- Portrait: playable, with a dismissible "Turn your phone sideways for the best view" hint. The camera FOV widens for a tall aspect ratio, so the road ahead stays in view.

## Review Focus

1. **A finger leaves the screen edge or the browser cancels the gesture** (`pointercancel`, `lostpointercapture`, app switch): that control releases, so the kart does not steer or drift forever.
2. **Two thumbs, then one lifts:** lifting the drift thumb must not reset steering, and the reverse.
3. **iOS page gestures:** a double tap zooms, a pinch zooms, a long press opens the callout or selects text, and an edge swipe scrolls the page. None of these may fire during play. Use `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`, `gesturestart` preventDefault, and a viewport meta with `viewport-fit=cover`.
4. **Rotation and resize mid-race:** controls re-layout, the canvas resizes, and nothing sticks.
5. **Small phones:** at 375×667 CSS px the HUD ticket card, lap counter and controls do not overlap one another or the notch area.

---

### Task 1: Touch input and steering math

**Files:** Create `src/touchInput.ts`; modify `src/input.ts` (add `createInput`); test `tests/touchInput.test.ts` (jsdom).

**Interfaces (Produces):**
```ts
// touchInput.ts
export function steerFromDrag(dxPx: number, deadZonePx?: number, fullPx?: number): number;  // clamp to [-1, 1]; drag right → negative (right)
export interface TouchControls { read(): KartInput; takeActions(): Action[]; setAutoGas(on: boolean): void; dispose(): void }
export function createTouch(root: HTMLElement): TouchControls;   // builds the DOM controls inside root
// input.ts
export interface InputSource { read(): KartInput; takeActions(): Action[]; dispose(): void }
export function createInput(sources: readonly InputSource[]): InputSource;  // steer: largest |value| wins; throttle/brake: max; drift: any
```

- [ ] **Step 1: Failing tests.** `steerFromDrag(0) === 0`; `steerFromDrag(5) === 0` (dead zone); `steerFromDrag(70) === -1`; `steerFromDrag(-200) === 1`; monotonic between. `createTouch` with pointer events on the pad and buttons: pad drag 70 px right → `steer -1`; DRIFT down → `drift true`; two pointers (pad + DRIFT), lift DRIFT → steer kept (Review Focus 2); `pointercancel` on the pad → steer 0 (Review Focus 1); window `blur` → everything released; auto-gas on → `throttle 1`, BRAKE held → `throttle 0, brake 1`; auto-gas off → `throttle 0` until GAS is held; pause button → `pause` action once. `createInput` merges a keyboard (steer +1) and a touch (steer −0.3) to steer +1.
- [ ] **Step 2:** Implement. Use `setPointerCapture` on each control. Run the tests: PASS.
- [ ] **Step 3:** Commit `feat(input): touch controls and merged input`.

### Task 2: Wire touch into the game, menus and page

**Files:** Modify `src/game.ts`, `src/ui/screens.ts`, `src/ui/hud.ts`, `src/ui/style.css`, `index.html`, `src/render/camera.ts`, `src/render/scene.ts`; create `src/ui/touch.css` if it keeps style.css readable.

- [ ] **Step 1:** `game.ts` uses `createInput([keyboard, touch])`. Show the touch layer as the Global Constraints say. Add the pause-menu items: auto-gas toggle and Respawn (touch only).
- [ ] **Step 2:** Menus: every option is a button element (≥ 44 px) with click handlers that call the same `handle(action)` path as the keyboard. The title screen says "Tap to start" on touch and "Press Enter" otherwise.
- [ ] **Step 3:** Page: viewport `width=device-width, initial-scale=1, viewport-fit=cover`; CSS for Review Focus 3; safe-area padding with `env(safe-area-inset-*)`; `gesturestart` and `dblclick` preventDefault on the document. Add `<meta name="apple-mobile-web-app-capable" content="yes">` and `<meta name="theme-color">`.
- [ ] **Step 4:** Rendering on coarse pointers: pixel ratio capped at 1.5 and shadows off. The camera widens FOV when `height > width`. Add the portrait hint.
- [ ] **Step 5:** HUD at 375×667: the ticket card shrinks (smaller font, steps on one line if needed) and nothing overlaps the controls (Review Focus 5).
- [ ] **Step 6:** Unit tests, typecheck, lint: clean. Commit `feat(ui): tappable menus, mobile page setup and touch layout`.

### Task 3: Mobile smoke tests

**Files:** Modify `playwright.config.ts`, create `e2e/touch.spec.ts`.

- [ ] **Step 1:** Add projects `mobile-webkit` (an iPhone device descriptor from Playwright's `devices`, landscape) and `mobile-chromium` (a Pixel descriptor, landscape). Both have `hasTouch: true`. Run `touch.spec.ts` only in these, and `smoke.spec.ts` only in the desktop projects.
- [ ] **Step 2:** `touch.spec.ts` with `?seed=1`:
  - touch controls are visible; on the desktop projects they are hidden (assert in `smoke.spec.ts`);
  - tap through title → setup (tap "1" lap) → Start → `screen()` reaches `racing` within 12 s;
  - with auto-gas, after 2 s `playerSpeed() > 5`;
  - a touch drag on the pad changes the kart heading (add `playerHeading()` to the debug hook);
  - the pause button → `paused`; tap Resume → `racing`;
  - rotate to portrait (`setViewportSize`) and back: no errors; controls still inside the viewport;
  - no `console.error` or `pageerror`.
  - Playwright `page.touchscreen` only taps; for drags dispatch `PointerEvent`s with `pointerType: 'touch'` via `locator.dispatchEvent`.
- [ ] **Step 3:** Run all projects locally (`PLAYWRIGHT_BROWSERS_PATH=$PWD/.pw-browsers`) and inside the CI container under Colima. All PASS.
- [ ] **Step 4:** Update the README (a touch controls table), `docs/changelog.md` (`## 0.2.0`), and bump `package.json` to `0.2.0` (the e2e title assertion follows it). Full check passes. Commit `feat: mobile smoke tests; v0.2.0`.
