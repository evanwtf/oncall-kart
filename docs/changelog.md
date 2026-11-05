# Changelog

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
