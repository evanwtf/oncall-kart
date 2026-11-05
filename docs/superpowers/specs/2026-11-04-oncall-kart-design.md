# oncall-kart: design

Date: 2026-11-04. Status: draft for Evan's approval.

## Intent

A browser kart racer where the race *is* the on-call queue. You drive laps
against bot rivals. Each kart carries a hardware ticket ("failed disk, r12-u07"),
and you close it by driving through operation gates in the runbook order.
A closed ticket pays out a boost and an item; a wrong gate costs you time.

It exists for **team fun and morale**. On-call engineers should recognise the
job and laugh. The runbooks only need to *feel* right; this is not a
training tool.

## Goals

- Plays well in desktop **Chrome and Safari** (macOS) with a keyboard.
- Low-poly 3D with a chase camera, drifting, item boxes, hazards and seven
  bot rivals: the feel of a classic arcade kart racer.
- Race length: the player picks **1, 3 or 10 laps**.
- The winner is the first kart across the line after the last lap. Tickets
  help you get there; they do not decide the result directly.
- Published at **https://evanwtf.github.io/oncall-kart/**, from a new
  **public** repo `evanwtf/oncall-kart`.

## Non-goals (v1)

- Touch controls, phones, tablets, gamepads. **Update (Evan, 2026-11-04):**
  "V1 can be desktop-only. Once that's working, add on-screen controls for
  mobile play." Touch controls follow as soon as the desktop build is live
  on Pages.
- Online multiplayer, accounts, server-side leaderboards.
- Accurate runbooks or any link to a real ops system.
- More than one track (the design allows more later).

## Anti-goals

- **No imitation of a specific game's look.** No names, characters, item
  designs, track layouts, art, music, sound effects or logos from any
  existing kart game, in particular Nintendo's. The genre mechanics (laps,
  drift boost, item boxes, rivals) are fine. The names of those games
  appear nowhere in the repo or the site.
- No real company, product or brand names (no vendor names on servers, no
  paging-service or chat-app names).
- No telemetry, no cookies, no third-party requests at runtime.

## The game

### Race flow

1. **Title screen:** game name, "press Enter", mute toggle hint.
2. **Setup:** pick lap count (1 / 3 / 10) and one of 8 driver colours.
3. **Countdown** 3-2-1, then race.
4. **Race:** 8 karts (player + 7 bots). Position, lap, ticket and item on the
   HUD.
5. **Results:** finishing order, plus a "shift report" for the player:
   tickets closed, wrong gates, SLA breaches, best lap.
6. Restart or back to setup.

### Tickets

- Each kart holds exactly one ticket at all times. It gets one at the start.
- A ticket is a **type** plus a fake location (`r<rack>-u<unit>`) and a
  ticket number. Each type has a fixed list of steps (the runbook).
- Steps must happen in order. The HUD shows the list with the next step
  highlighted.
- When the last step completes, the ticket **closes**: a boost and a free
  item, then a new random ticket at once. A ticket may span lap boundaries.
- **SLA timer:** each ticket has a time limit (tuned so an average driver
  closes a typical ticket in about 1.5 laps). On breach the kart is "paged":
  a short slowdown, a screen shake for the player, and a fresh ticket. The
  breach counts in the shift report.

### Gates

- The track has **gate rows** across the road: about 6 per lap. Each row holds
  2-3 gates with open lanes between them, so the player chooses a lane.
- A gate is a labelled arch: `MAINT`, `TAKEDOWN`, `POWERON`, `REINSTATE`,
  `FW-ISO`, `LOGCOLLECT`, `META-SYNC`, `REIMAGE`.
- Through the **next needed** gate: the step completes (chime, green flash).
- Through **any other gate**: "not in the runbook". A short spin and a speed
  loss (about 1 s lost). The step does not advance.
- Through an open lane: nothing.
- **Gate labels reshuffle each lap** ("the change board moved"), so players
  read the gates instead of memorising them. Every operation appears at least
  once on the board.
- **One shared board (my call).** All karts see the same labels. Each row
  reshuffles just after the *player* passes through it, so no row changes
  while the player approaches it. Bots read the live board.

### Pit stop (physical work)

- A pit lane branches off the main straight and rejoins it.
- A `PIT` step means hands-on work (swap the disk, swap the CPU). Drive
  through the pit lane: the kart stops about 2 s while a tech does the swap,
  then exits.
- Entering the pit when the next step is not `PIT` just costs time.

### Runbooks

The operation names and meanings come from Evan. He confirmed on
2026-11-04 that they are safe to publish.

| Operation | Meaning |
| --- | --- |
| MAINT | Enter maintenance: stop tenant services, make ready for work |
| TAKEDOWN | Maintenance plus power off |
| POWERON | Power on |
| REINSTATE | Inverse of maintenance; powers the machine on if it is off |
| FW-ISO | Maintenance, then boot the firmware-updater ISO |
| LOGCOLLECT | Maintenance, then boot the log-collector ISO |
| META-SYNC | Pull the latest server metadata (hostname, serial, MACs) upstream |
| REIMAGE | Reinstall the OS (added for the cluster rebuild ticket) |

Ticket types and steps (my call, from Evan's list plus "etc."). They live in
one data file so anyone can edit them:

| Ticket | Steps |
| --- | --- |
| Failed disk | TAKEDOWN → PIT → REINSTATE |
| Outdated firmware | FW-ISO → REINSTATE |
| Bad CPU | LOGCOLLECT → TAKEDOWN → PIT → POWERON → META-SYNC → REINSTATE |
| Switch maintenance | MAINT → PIT → META-SYNC → REINSTATE |
| Rebuild tenant cluster | MAINT → REIMAGE → META-SYNC → REINSTATE |
| Overheating GPU | LOGCOLLECT → TAKEDOWN → PIT → REINSTATE |
| Bad DIMM | LOGCOLLECT → TAKEDOWN → PIT → REINSTATE |
| Flapping NIC | MAINT → FW-ISO → META-SYNC → REINSTATE |
| Wrong hostname in inventory | META-SYNC |

### Items

Item boxes are **hazard-striped change-request crates** that respawn a few
seconds after pickup. A kart holds one item at a time.

| Item | Effect |
| --- | --- |
| Coffee | Short speed boost |
| Rollback | Cancels your next penalty (wrong gate, hazard or hit) |
| Firewall | Shield that blocks one hit for a few seconds |
| Page | Projectile fired forward; it homes on the kart ahead and spins it |
| Spilled coffee | Puddle dropped behind you; karts that hit it spin |

Coffee, Rollback and Firewall are agreed. Page and Spilled coffee are my
call: bot rivals need something to hit and be hit by.

### Hazards

- **Cable spaghetti:** slick patches; you spin.
- **Change-freeze ice:** low-grip zones; you slide wide.
- **Rogue cron jobs:** barrels that roll across the track on a timer; a hit
  spins you.

### Driving

- Arcade physics on a flat ground plane, no physics library: acceleration,
  top speed, steering, friction, and off-road slowdown on the floor tiles
  beside the road. Track edges are soft walls.
- **Drift:** hold Space while turning. Sparks grow through three stages;
  release for a mini-boost sized by the stage.
- Brief rubber-banding for bots only, so the pack stays close.
- **Respawn:** if a kart is stuck or off the track for too long, it returns
  to the nearest track point.

### Bot rivals

Seven bots follow the racing line with lane offsets. Each bot holds its own
ticket and steers toward its next needed gate, with a per-bot skill level
that sets top speed, line accuracy and wrong-gate rate. Bots pick up and use
items.

### Track: the data-centre hall

One closed-loop track through a data-centre hall: rows of server racks with
blinking LEDs, cold-aisle blue light, raised floor tiles, cable trays
overhead, and a loading-dock straight with the pit lane. Original low-poly
geometry built in code; no downloaded models.

### Drivers

Eight original on-call engineers: low-poly figures in hoodies and headsets,
each with a colour and a joke name (for example "Rollback Rae", "Pager
Pat"). No resemblance to any existing character.

### Controls (keyboard)

| Key | Action |
| --- | --- |
| ↑ / W | Accelerate |
| ↓ / S | Brake, reverse |
| ← → / A D | Steer |
| Space | Drift (hold) |
| Shift / E | Use item |
| R | Respawn |
| P / Esc | Pause |
| M | Mute |

### Sound

All sound is synthesised in the browser with Web Audio (engine hum, drift,
boost, gate chime, wrong-gate buzz, item sounds) plus a short original
looping tune. Audio starts on the first key press, because Safari blocks
sound before a user gesture. M mutes.

## Constraints

- **Browsers:** current Chrome and Safari on macOS. WebGL 2 required.
- **Performance:** 60 fps on a recent MacBook with 8 karts on screen.
- **Hosting:** GitHub Pages, served under the `/oncall-kart/` sub-path.
  Static files only.
- **Public repo** (baseline `conventions/public-repos.md`): no hostnames, LAN
  IPs, home-directory paths or secret names in any file, commit or issue.
- **No Claude session links or IDs** in commits, PRs or files.
- **License: MIT** (Evan, 2026-11-04).
- No deadline. **Build in phases, playable early (my call):** phase 1 is one
  kart on the track with gates, tickets and laps, deployed to Pages. Phase 2
  adds bots, items and hazards. Phase 3 adds sound, polish and tuning.
- Performance target: hold 60 fps on the weakest current MacBook Air.
- Delivery follows baseline D1: push to `main` until there are real users.
- Delivery uses the agent team (worker in a worktree, one reviewer pass
  before push).

## How it gets made (my calls)

- **TypeScript + Vite + three.js.** Vite builds static files with the right
  base path for Pages. three.js is the only runtime dependency.
- **Game logic separate from rendering:** tickets, runbooks, gates, laps,
  positions, items and bot decisions are plain TypeScript with no three.js
  imports, so unit tests run in Node.
- **Tests:** Vitest unit tests for the logic (TDD for gate order, lap
  counting and positions: bugs there silently corrupt the race). Playwright
  smoke tests run the built site in **Chromium and WebKit** (WebKit stands in
  for Safari): the page loads, WebGL starts, a race begins, no console
  errors.
- **Lint and format:** ESLint and Prettier, `tsc --noEmit` in strict mode.
- **CI:** GitHub Actions on the self-hosted Linux runner
  (`[self-hosted, Linux, X64]`). Lint, typecheck, unit tests, build, then the
  Playwright smoke in the official Playwright container image.
- **Deploy:** on push to `main`, after CI passes, build and publish to Pages
  with `actions/deploy-pages`. No release tags in v1; the version in
  `package.json` shows on the title screen.
- **Pre-commit:** baseline's standard hooks (large files, merge conflicts,
  YAML, end of file, whitespace, private keys, gitleaks) plus local lint and
  typecheck hooks.
- **Repo layout:** `src/` (game), `src/logic/` (pure logic), `tests/`,
  `e2e/`, `docs/plan.md`, `docs/changelog.md`, `AGENTS.md` with `CLAUDE.md`
  and `GEMINI.md` symlinks, README with a Bootstrap section first.

## Left to the builder

- Exact tuning: speeds, drift stages, SLA times, penalty lengths, bot skill.
- Track shape, as long as a lap takes roughly 40-60 s at average pace and
  holds about 6 gate rows, a pit lane, item-box rows and the three hazards.
- HUD layout and art details, inside the anti-goals.
- Driver names and joke lines ("not in the runbook", shift-report captions).
- How the tune sounds.
