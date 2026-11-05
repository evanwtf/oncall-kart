# Changelog

## 0.2.0

Touch controls: the game plays on a phone or a tablet.

- On a touchscreen, on-screen controls show on the track. The left half of
  the screen steers: put a thumb down and drag left or right. DRIFT and
  BRAKE sit at the bottom right, and the pause button at the top right.
  Keyboard play does not change.
- The last device used wins. A touch shows the controls; a driving key
  hides them and stops auto-gas, so a touchscreen laptop or a tablet with a
  keyboard keeps the keyboard brake.
- Auto-gas is on by default for touch: the kart drives unless you hold
  BRAKE. The pause menu turns it off; GAS then shows as a hold button. The
  choice is saved in the browser.
- The pause menu on touch also has Respawn, since there is no R key.
- Every menu takes taps and mouse clicks. Setup has Back and Start buttons;
  the shift report has Setup and Race again. In the pause menu, tap an
  option to select it and tap it again to confirm.
- Phones get a smaller HUD, a lower pixel ratio and no shadows. On a short
  landscape screen the ticket card shows only the next step, so the gate
  signs stay in view. The pause menu hides the ticket card and the speed.
  Portrait works, with a wider camera and a hint to turn the screen
  sideways.
- Page zoom, scroll, text selection and the long-press callout are off.
- Smoke tests now also run on a phone in landscape, in WebKit and Chromium.

## 0.1.1

Fixes from the phase 1 review.

- Gate labels now match the change board. A reshuffle swaps labels only
  into rows behind you, and the screen redraws every row that changed.
- Gates read from about 50 m: bigger labels filled with the operation's
  color, unlit beams, and labels on the approach side only. The ticket card
  shows the next step in its gate color.
- Gate rows sit on straights or the fast sweeper, never in a hairpin. The
  back aisle is now straight; the lap is 754 m with 5 gate rows of 3 gates.
- The pit serves a `PIT` step at the pit box, between the entry and the
  exit. A dip into the opening no longer counts, and R does not skip the
  pit work. The stop is 1 s; the whole lane costs about 4 s.
- Scraping along a wall at a shallow angle no longer grinds the kart to a
  stop.
- The game pauses when the window loses focus. Cmd-key combinations no
  longer leave a key stuck down.
- A brighter hall.
- The public-repo guard reads a private denylist and allows only the exact
  fake values in its own tests and the plan.

## 0.1.0

Phase 1: one kart, live on GitHub Pages.

- The data-centre hall: a 772 m loop with a loading-dock straight, a pit
  lane, a fast sweeper and two hairpins. Rack rows with blinking LEDs, cable
  trays and a raised floor.
- Tickets: nine hardware ticket types, each with a runbook. Drive through
  the operation gates in order. A wrong gate spins you (about 1 s lost). A
  closed ticket gives a boost and a new ticket.
- The change board: 6 gate rows a lap. After you pass a row, its labels swap
  with rows behind you. The two rows ahead of you never change.
- The pit lane: a `PIT` step means hands-on work. The kart stops for 2 s while the tech works.
- SLA timer: a breach pages you, slows you down and issues a fresh ticket.
- Races of 1, 3 or 10 laps. Eight drivers to pick from.
- Arcade driving: drift with Space for a three-stage mini-boost. Soft walls,
  an off-road strip and automatic respawn.
- Title, setup, countdown, HUD, pause and shift-report screens.
- CI on the self-hosted Linux runner, with smoke tests in Chromium and
  WebKit. Every push to `main` deploys to GitHub Pages.
- Guards for public-repo leaks and agent session IDs.
