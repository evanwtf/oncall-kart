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

Live: <https://evanwtf.github.io/oncall-kart/>. It needs desktop Chrome or
Safari with WebGL 2.

| Key       | Action         |
| --------- | -------------- |
| ↑ / W     | Accelerate     |
| ↓ / S     | Brake, reverse |
| ← → / A D | Steer          |
| Space     | Drift (hold)   |
| R         | Respawn        |
| P / Esc   | Pause          |
| Enter     | Confirm        |

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

See [AGENTS.md](AGENTS.md) for the commands, the checks and the rules.

## License

MIT. See [LICENSE](LICENSE).
