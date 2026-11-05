# oncall-kart

Two browser games about being on call:

- **oncall-kart**, a kart racer where the race is the on-call queue. Each
  kart carries a hardware ticket. You close it by driving through operation
  gates in runbook order.
- **Zero Down**, a first-person shift on a data-centre floor. Servers break
  at random. You walk to each broken rack and work through its runbook, and
  you apply every security patch before the shift ends. Vendors crowd you,
  and a money gun keeps them busy.

## Bootstrap

You need Node 26 (see `.nvmrc`) and git.

```sh
git clone https://github.com/evanwtf/oncall-kart.git
cd oncall-kart
npm ci
npm run dev
```

Open the URL that `npm run dev` prints (it ends in `/oncall-kart/`).

## Play

Live: <https://evanwtf.github.io/oncall-kart/>. It needs Chrome or Safari
with WebGL 2. The kart game runs on a desktop, a phone or a tablet. Zero
Down needs a mouse and a keyboard.

The first screen picks the game: the arrow keys and Enter, a click or a tap.
A link can skip the start screen:

```sh
export SITE=https://evanwtf.github.io/oncall-kart/
open "$SITE?game=kart"
open "$SITE?game=shooter"
```

The kart title screen has a **Switch game** button. Zero Down returns to the
start screen from its briefing, its pause menu and its shift report.

### oncall-kart

| Key       | Action         |
| --------- | -------------- |
| ↑ / W     | Accelerate     |
| ↓ / S     | Brake, reverse |
| ← → / A D | Steer          |
| Space     | Drift (hold)   |
| Shift / E | Use item       |
| R         | Respawn        |
| P / Esc   | Pause          |
| M         | Sound on, off  |
| Enter     | Confirm        |

On a phone or a tablet, on-screen controls show on the track. Turn the
screen sideways for the best view. A driving key hides them again and hands
control back to the keyboard.

| Control                     | Action                                      |
| --------------------------- | ------------------------------------------- |
| Left half: drag left, right | Steer                                       |
| DRIFT (hold)                | Drift                                       |
| ITEM (above DRIFT)          | Use item                                    |
| BRAKE (hold)                | Brake, reverse                              |
| GAS (hold, above BRAKE)     | Accelerate, when auto-gas is off            |
| II (top right)              | Pause                                       |
| Pause menu                  | Respawn; auto-gas on or off (on by default) |
| Pause menu: Sound           | Sound on or off                             |

Tap the title to start. On setup, tap the laps and a driver, then Start.
In the pause menu, tap an option to select it and tap it again to confirm.
Mouse clicks work the same way.

The sound starts on your first key press or tap: browsers block sound
before one. M, or Sound in the pause menu, turns it off and on. The game
remembers the choice, and shows a muted-speaker mark while the sound is off.
On an iPhone or an iPad, the ring/silent switch also mutes the game.

In menus, the arrow keys choose, Enter confirms and Esc goes back. Pick
1, 3 or 10 laps and a driver on the setup screen. The ticket card (top
right) shows the runbook: drive through the gate that matches the next
step. A `PIT` step means the pit lane on the left of the dock straight.

### Zero Down

A shift lasts 3 minutes. The briefing lists the patches due this shift.
Click to start: the game takes the mouse, and Esc gives it back.

| Key              | Action                          |
| ---------------- | ------------------------------- |
| W A S D / arrows | Move and strafe                 |
| Mouse            | Look                            |
| Left click       | Fire the money gun              |
| 1-9              | Pick a step at a broken rack    |
| E (hold)         | Work: a runbook step or a patch |
| P / Esc          | Pause                           |

A broken rack shows a red beacon, and its ticket card shows the runbook
with the next step in color. Face the rack, pick the step with its number
key, then hold E until the bar fills. If you move or let go, the step
stops. A wrong step fills the bar, then fails. A patch target has a blue
marker: face it and hold E. The floor map (bottom right) shows you, the
broken racks in red, the patch targets in blue, vendors in orange and
approved POs in green.

#### Vendors

Vendors walk in from the loading dock, more as the shift goes on: an
account exec, a renewal rep, a license auditor, a support agent and a
solutions architect. They walk to you. A wrong step sets off an alarm that
calls the vendors within 30 m to that rack for 8 s.

Each vendor within 2 m takes 20 points off your speed, down to 10%:

| Vendors close by | Your speed and work rate |
| ---------------- | ------------------------ |
| 0                | 100%                     |
| 1                | 80%                      |
| 2                | 60%                      |
| 3                | 40%                      |
| 4                | 20%                      |
| 5 or more        | 10%                      |

The slowdown applies to the work bar too. A vendor behind a wall or a rack
does not count. You can walk through
vendors, and your speed comes back as soon as you get clear.

The money gun fires bills. Each shot costs $500 of the shift's $20,000
budget. A vendor that is hit stops to pick up the money for 5 s (the
license auditor, 2 s). Bills that miss land on the floor, and a vendor
that walks past stops to pick them up. With no budget, the gun clicks. An
approved PO on the floor adds $5,000 and comes back after 30 s. One
toolkit per shift, in a data hall, makes every step faster.

At 0:00 the shift ends:

| Ending      | When                                                    |
| ----------- | ------------------------------------------------------- |
| Clean shift | Every patch applied and no server broken                |
| Rough shift | Every patch applied, but one or more servers are broken |
| Fired       | A patch not applied                                     |

The pause menu sets the mouse sensitivity. The game remembers it.

## Edit the runbooks

The ticket types live in `src/logic/runbooks.ts`. Each type has an id, a
title and a list of steps. A step is an operation (`MAINT`, `TAKEDOWN`,
`POWERON`, `REINSTATE`, `FW-ISO`, `LOGCOLLECT`, `META-SYNC`, `REIMAGE`) or
`PIT`. A type with a `PIT` step also needs `pitWork`, the text the pit crew
shows. Both games use this file: in Zero Down, `PIT` is the hands-on work at
the rack, and the rack panel shows `pitWork`. Run `npm test` after an edit.

## Develop

Before the first smoke-test run, install the test browsers:

```sh
npx playwright install chromium webkit
npx playwright test
```

See [AGENTS.md](AGENTS.md) for the commands, the checks and the rules.

## License

MIT. See [LICENSE](LICENSE).
