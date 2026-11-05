# oncall-kart

A browser kart racer where the race is the on-call queue. Each kart carries a
hardware ticket. You close it by driving through operation gates in runbook
order.

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
with WebGL 2, on a desktop, a phone or a tablet.

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

In menus, the arrow keys choose, Enter confirms and Esc goes back. Pick
1, 3 or 10 laps and a driver on the setup screen. The ticket card (top
right) shows the runbook: drive through the gate that matches the next
step. A `PIT` step means the pit lane on the left of the dock straight.

## Edit the runbooks

The ticket types live in `src/logic/runbooks.ts`. Each type has an id, a
title and a list of steps. A step is an operation (`MAINT`, `TAKEDOWN`,
`POWERON`, `REINSTATE`, `FW-ISO`, `LOGCOLLECT`, `META-SYNC`, `REIMAGE`) or
`PIT`. A type with a `PIT` step also needs `pitWork`, the text the pit crew
shows. Run `npm test` after an edit.

## Develop

Before the first smoke-test run, install the test browsers:

```sh
npx playwright install chromium webkit
npx playwright test
```

See [AGENTS.md](AGENTS.md) for the commands, the checks and the rules.

## License

MIT. See [LICENSE](LICENSE).
