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
