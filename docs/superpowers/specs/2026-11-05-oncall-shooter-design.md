# oncall shooter ("Zero Down"): design

Date: 2026-11-05. Status: approved by Evan, 2026-11-05.

## Intent

A first-person shooter that lives beside the kart game in this repo and on
the same site. A game is one on-call shift on a data-centre floor. Servers
break at random. You go to each broken rack and fix it, step by step
through its runbook, while vendors crowd you. You keep them off with a
money gun.

It exists for the same reason as the kart game: **team fun and morale**.
On-call engineers should recognise the job and laugh. The runbooks only
need to feel right.

"Zero Down" is a working title (my call). It names the goal: zero servers
down at the end of the shift.

## What Evan decided (2026-11-05)

- **Same repo and site** as the kart game. The player chooses which game.
- The feel of the classic fast 3D shooters of the 1990s.
- **Fixing a server is like applying a health kit**, and it works **like a
  bomb defuse in a team shooter**: you stand at the rack and work while a
  bar fills, and you are exposed while you work.
- **The enemies are vendors.**
- **Vendors don't kill you. They slow you down.** "If a vendor gets too
  close your speed decreases 20% down to a floor of 10%." The slowdown
  lasts only while vendors are close; it is not lasting damage.
- **The weapon is a money gun.** "It distracts them."
- **The goal:** finish the shift with 0 broken servers. Servers break at
  random during the shift.
- **Chores:** "you have other stuff you need to do as well like apply cve
  patches. If you don't apply the patches you get fired."
- **Shift length: 3 minutes** "to start".

## Goals

- Plays well in desktop **Chrome and Safari** (macOS) with a mouse and
  keyboard.
- Low-poly 3D, first person, fast movement: the feel of a classic arcade
  shooter.
- A start screen where the player picks the kart game or the shooter.
- Live at **https://evanwtf.github.io/oncall-kart/**, deployed the same way
  as the kart game.

## Non-goals (v1)

- Touch controls, phones, tablets, gamepads. Touch follows later, as it did
  for the kart game.
- Multiplayer, teammates, accounts, leaderboards.
- Shift lengths other than 3 minutes.
- More than one map. Stairs, jumping and floors above or below (my call: one
  flat floor keeps the first build small).
- Chores other than CVE patches. The design allows more later.

## Anti-goals

- **No IP from any existing shooter**, in particular id Software's and
  Valve's: no names, characters, monsters, weapon designs, maps, HUD faces,
  music, sound effects or logos. The names of those games appear nowhere in
  the repo or the site. Genre mechanics (first-person movement, a progress
  bar to defuse, pickups) are fine.
- **No real company, product or brand names.** Vendors are job roles, never
  real companies, and carry no logos. No vendor is a caricature of a real
  person.
- **No blood, no gore, no realistic guns.** Nobody gets hurt. A vendor that
  is hit stops to pick up the money. The money gun is a cartoon.
- **No real CVE numbers.** Patch names are clearly fictional.
- No telemetry, no cookies, no third-party requests at runtime.
- **The kart game must not break.** Its tests stay green.

## The game

### Start screen

A new first screen offers two cards: the kart game and the shooter. Arrow
keys and Enter, a mouse click or a tap pick a card. The kart game then
opens on its own title screen, as it does today.

My call: `?game=kart` and `?game=shooter` skip the picker, so links and
tests can go straight to a game.

### The shift

1. **Briefing:** the shift's patch list and the controls. A click starts
   the shift, because the browser needs a click to lock the mouse.
2. **The shift:** a 3:00 clock counts down. Servers break, vendors arrive,
   you fix and patch.
3. **End:** at 0:00 the shift ends, with one of three endings and a shift
   report.

| Ending | When |
| --- | --- |
| Clean shift | Every patch applied and 0 broken servers |
| Rough shift | Every patch applied, but 1 or more servers still broken |
| Fired | Any patch not applied (this wins over a rough shift) |

The shift report lists tickets closed, SLA breaches, wrong steps, patches
applied, vendors distracted and money spent. Then: play again, or back to
the start screen.

### The floor

One data-centre floor, built in code from original low-poly geometry. It
reuses the look of the kart game's hall where that fits: racks with
blinking LEDs, raised floor tiles, cold-aisle blue light. My call on the
areas:

- **Data halls:** rows of racks with aisles between them. Most broken
  servers are here.
- **Network room:** switches and firewalls. Most patches go here.
- **Break room:** where the shift starts.
- **Loading dock:** where vendors come in.

A walk from one end to the other takes about 20-25 s at full speed. A small
floor map in a corner shows you, broken servers and patch targets.

### Broken servers and tickets

- At random times a server breaks. Its rack shows a red beacon, and a
  ticket card appears on the HUD: type, location (`r12-u07`), runbook, SLA
  timer. More than one server can be broken at once.
- Ticket types and runbooks come from the kart game's data file
  (`src/logic/runbooks.ts`). One file, both games. The `PIT` step is the
  hands-on work at the rack; the panel shows its text ("swap the disk").
- **SLA breach (my call):** the server stays broken, the ticket stays open,
  and the shift report counts the breach. A breach does not end the shift.
- Pace (my call, tune by feel): the first break comes about 10 s into the
  shift, and about 6 servers break in a 3-minute shift. A good player ends
  clean about half the time.

### Fixing a server (the defuse)

- Face the broken rack, close up. A panel lists the operations and the
  hands-on step, each with a number key: `MAINT`, `TAKEDOWN`, `POWERON`,
  `REINSTATE`, `FW-ISO`, `LOGCOLLECT`, `META-SYNC`, `REIMAGE`, and the
  hands-on step.
- Pick a step with its number key, then **hold E**. A bar fills: about 2 s
  for an operation, about 4 s for hands-on work (my call, tune).
- While you hold E you cannot move or fire. If you let go or move, the
  step stops and its bar resets, as a defuse does.
- **The right step** (the next one in the runbook) completes: a chime, and
  the ticket card moves to the next step.
- **A wrong step** fills the bar, then fails: the time is lost, a buzz
  sounds, and an alarm calls nearby vendors to the rack. The runbook does
  not move. (My guess, which Evan saw and did not correct.)
- After the last step the server is healed: the beacon turns green, and
  the ticket closes.
- **Vendors slow the bar (my call).** The slowdown below applies to the
  bar as well as to movement, because vendors keep talking at you while
  you work. Without it, vendors could not hurt you at the rack.
- **Toolkit pickup (my call, phase 2):** makes every step faster for the
  rest of the shift, as the defuse kit does.

The HUD ticket card shows the runbook with the next step highlighted, as in
the kart game. The test is to pick the right step under pressure, not to
remember the runbook.

### CVE patches

- The briefing lists the shift's patches (about 3; my call). Each one names
  a device: a switch, a firewall or a server.
- Apply a patch at its device with the same hold-E action: one step, about
  3 s, no runbook.
- A patch not applied by 0:00 gets you fired.
- The HUD keeps a patch checklist, and the floor map marks each target.

### Vendors

- Vendors walk in from the loading dock during the shift, more as the shift
  goes on. They walk toward you, and toward alarms.
- **Too close (Evan's rule):** each vendor within close range (about 2 m;
  my call) takes 20 percentage points off your speed. They stack, down to a
  floor of 10%. Speed depends only on how many vendors are close right now
  (Evan confirmed this reading):

  | Vendors close by | Your speed |
  | --- | --- |
  | 0 | 100% |
  | 1 | 80% |
  | 2 | 60% |
  | 3 | 40% |
  | 4 | 20% |
  | 5 or more | 10% |

  A distracted vendor does not count. Your speed comes back as soon as you
  get clear.
- Vendors cannot trap you. You can always push past them at your slowed
  speed (my call).
- **Roles (my call; names, lines and art left to the builder):** the
  account executive (fast), the renewal rep, the license auditor (slow, and
  money holds it for less time), the support agent who asks for logs
  again, and the solutions architect. Each is a low-poly figure with a
  lanyard and a prop: a clipboard, a laptop, a slide deck.

### The money gun

- Click to fire a spray of bills. A vendor that is hit stops, picks up the
  money, and stays distracted for a few seconds (about 5 s; tune).
- Bills that miss land on the floor. A vendor that walks past them stops to
  pick them up, so a miss still works as a lure (my call).
- **Budget is the ammo (my call).** The shift starts with a budget, and
  each shot spends some of it. Budget pickups ("approved PO") lie on the
  floor and come back after a while. With no budget left, the gun clicks.
- It looks like a cartoon cash blower, not a firearm, and like no weapon in
  any existing game.

### Controls (desktop)

| Key | Action |
| --- | --- |
| W A S D / arrows | Move and strafe |
| Mouse | Look |
| Left click | Fire the money gun |
| E (hold) | Work: a runbook step or a patch |
| 1-9 | Pick the step at a rack |
| P / Esc | Pause |
| M | Mute |

- The mouse locks to the game on click (Pointer Lock, which Chrome and
  Safari support). Esc releases it and pauses the shift.
- Full speed is the default; there is no run key (my call, as in the
  classic games).
- The pause menu has a mouse-sensitivity setting (my call).

### HUD

Shift clock, ticket cards (one per broken server, each with its SLA bar),
patch checklist, budget, crosshair, floor map. When vendors slow you, the
HUD shows your speed and how many vendors are close.

### Sound

Synthesised with the kart game's Web Audio engine: money gun, vendor
chatter (synthesised babble, no words), the work bar, step OK, wrong step,
alarm, ticket closed, patch applied, and the end-of-shift jingles. One
original tune. M mutes. Sound is in a later phase.

## Constraints

- Every constraint of the kart design still holds: Chrome and Safari on
  macOS, WebGL 2, static files on GitHub Pages under `/oncall-kart/`, the
  public-repo rules, no Claude session links or IDs, MIT, delivery per
  baseline D1 (push to `main`), the agent team with one review before each
  push.
- **Performance:** 60 fps on the weakest current MacBook Air, with 20
  vendors on screen.
- The kart game keeps its URL behaviour and its tests. Its e2e tests reach
  it through the picker or `?game=kart`.

## How it gets made (my calls)

- **Same stack:** TypeScript, Vite, three.js. No new runtime dependency.
- **Logic apart from rendering**, as in the kart game: the shooter's rules
  (break schedule, runbook stepping, patches, the slowdown rule, vendor
  decisions, endings) are pure TypeScript with no three.js and no DOM, on a
  fixed step with the seeded RNG. Shared pieces (runbooks, operations, RNG,
  audio engine, input) are shared, not copied. The builder picks the
  folder layout.
- **Tests:** TDD for the break schedule, runbook stepping, the slowdown
  table above, budget and the endings. Playwright smoke tests in Chromium
  and WebKit: picker to shooter, a shift starts, a scripted fix closes one
  ticket, the shift ends with the right ending, no console errors. The kart
  smoke tests still pass.
- **Version:** the first shooter release is `0.5.0`.
- **Timeline:** `docs/timeline.md` gets the shooter's rows. Work started
  2026-11-05T09:50-05:00.

### Phases (my call: playable early)

1. **Walk and fix:** the start screen, the floor, movement, servers that
   break, fixing at the rack, patches, the 3-minute shift, the three
   endings, the shift report. Live on Pages.
2. **Vendors and the money gun:** vendor roles, the slowdown, the gun,
   budget and its pickups, lures, alarms, the toolkit.
3. **Sound, touch and polish:** sound and music, on-screen controls for
   phones, a tuning pass.

## Left to the builder

- Exact tuning: speeds, step times, SLA times, break pace, vendor arrivals,
  budget, distraction time.
- The floor layout, inside the areas and walk time above.
- Vendor names, lines and art; HUD layout; which devices get patches.
- Joke text for the endings and the shift report.
