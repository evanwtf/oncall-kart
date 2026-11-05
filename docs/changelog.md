# Changelog

## 0.5.0

A second game, Zero Down, and a start screen that picks the game.

- The first screen offers two cards: the kart game and Zero Down. The
  arrow keys and Enter, a click or a tap pick one. `?game=kart` and
  `?game=shooter` skip the start screen. The kart title screen has a
  Switch game button.
- Zero Down, phase 1 ("walk and fix"): a first-person, 3-minute shift on a
  data-centre floor of 640 racks. The floor has two data halls, a network
  room, a break room where the shift starts, and a loading dock. W A S D
  moves; the mouse looks, through Pointer Lock.
- Six servers break at random in a shift. A broken rack shows a red beacon
  and a ticket card with its runbook and SLA. The ticket types come from
  the kart game's `runbooks.ts`. Pick a step with 1-9 and hold E to work:
  2 s for an operation, 4 s for hands-on work. Moving or letting go stops
  the step. A wrong step fills the bar, then fails.
- Three made-up security patches per shift, on a switch, a firewall and a
  rack. Hold E at the target for 3 s. A missed patch gets you fired.
- Three endings: clean shift, rough shift, fired, with a shift report.
- The pause menu sets the mouse sensitivity. A hidden tab, a lost focus or
  a lost mouse lock pauses the shift.
- Vendors, the money gun, sound and touch come in later phases.

## 0.4.0

Phase 3: sound, an original tune, and render polish.

- All sound is made in the browser with Web Audio. There are no audio files.
  Countdown blips, gate chimes, a buzz for a wrong gate, an arpeggio for a
  closed ticket, a pager beep for an SLA breach, pit ratchets, drift ticks,
  boost and item sounds, hits, a lap chime, a final-lap call built on the
  tune's opening notes, and a finish fanfare that grows with your place. Hits on rivals fade with distance.
- The engine hums with your speed, and sounds rougher off the road.
- An original 16-bar tune in D minor loops in the race, in square, triangle
  and noise voices at 140 BPM. The final lap plays it 8% faster. The title
  and results screens play a calmer version.
- The sound starts on the first key press or tap. M mutes, and so does
  Sound in the pause menu. The game remembers the choice and shows a mark
  while muted. A pause ducks the music and stops the engine. A hidden tab
  stops all sound until you come back. On iOS, the ring/silent switch also
  mutes the game.
- M, P and R with Cmd, Ctrl or Alt held are left to the browser: Cmd+M no
  longer toggles the sound as it minimizes the window.
- Without Web Audio, the game runs silent.
- The pause screen is still: wheels, sparks and lights stop.
- A respawn draws the kart at its new spot at once, and the camera snaps
  there instead of swooping.
- When the window moves to a display with another pixel ratio, the game
  redraws at the new ratio.
- CI refuses an e2e image whose Node major version differs from `.nvmrc`.
  A smoke test loses and restores the WebGL context and checks the race
  keeps drawing.

## 0.3.0

Phase 2: seven bot rivals, items and hazards.

- Every race has 8 karts: you and 7 bots. Each bot holds its own ticket,
  steers for the gate of its next step, takes the pit when it needs it, and
  makes mistakes by its skill. The strongest bot laps the hall in about
  40 s, so a good run beats it. Bots rubber-band a little to keep the pack
  close.
- Karts bump each other. The grid holds all 8, after the line, and you
  start at the back.
- The HUD shows your place (it pops when it changes), the item you hold, and
  a minimap with a dot per kart. Each rival has a name tag that fades with
  distance. On a short phone screen the minimap hides, so the gate signs
  stay in view.
- Item boxes are change-request crates in three rows. A closed ticket also
  gives an item. Coffee boosts you. Rollback cancels your next penalty.
  Firewall blocks one hit for 5 s. Page homes on the kart ahead and spins
  it. Spill drops a puddle behind you. Trailing karts roll more Coffee and
  Pages; leaders more Firewalls and Spills.
- Hazards: cable spaghetti spins you, change-freeze ice makes you slide wide
  in two hairpins, and two rogue cron barrels roll across the road.
- Use the item with Shift or E, or the ITEM button above DRIFT on touch.
  On touch, GAS (with auto-gas off) now sits above BRAKE.
- Toasts say who paged you, and when your Firewall held or your Rollback
  saved you.
- The results show the finishing order of all 8, frozen when you cross the
  line, then your shift report.
- The logic runs in fixed steps, so the same seed and the same per-step
  inputs give the same race at any frame rate. The game reads your input
  once per frame, so a human run does not replay exactly.

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
