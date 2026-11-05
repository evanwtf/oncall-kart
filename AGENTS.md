# oncall-kart

Two browser games about being on call, for team fun. The kart racer: the race
is the on-call queue, and you close hardware tickets by driving through
operation gates in runbook order. Zero Down: a first-person shift on a
data-centre floor, where you fix broken racks and apply patches. A start
screen picks the game. TypeScript, Vite and three.js; static files on GitHub
Pages.

Live site: <https://evanwtf.github.io/oncall-kart/>.
Designs: [the kart game](docs/superpowers/specs/2026-11-04-oncall-kart-design.md)
and [Zero Down](docs/superpowers/specs/2026-11-05-oncall-shooter-design.md).
Phases: [docs/plan.md](docs/plan.md).

## Commands

| Command                         | What it does                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `npm ci`                        | Install the locked dependencies                                 |
| `npm run dev`                   | Start the dev server                                            |
| `npm run build`                 | Typecheck, then build `dist/` for the `/oncall-kart/` base path |
| `npm run preview`               | Serve `dist/`                                                   |
| `npm test`                      | Unit tests (Vitest)                                             |
| `npm run typecheck`             | `tsc --noEmit`, strict                                          |
| `npm run lint`                  | ESLint                                                          |
| `npm run format:check`          | Prettier check (`npm run format` writes)                        |
| `npx playwright test`           | Smoke tests in Chromium and WebKit on the built site            |
| `node scripts/check-public.mjs` | Public-repo guard over tracked files                            |

Install the Playwright browsers once per clone, before the first e2e run:

```sh
npx playwright install chromium webkit
```

Run the full check before you push:

```sh
npm run format:check && npm run lint && npm run typecheck && npm test \
  && node scripts/check-public.mjs && npm run build && npx playwright test
```

Install the hooks once per clone:

```sh
uvx pre-commit install --hook-type pre-commit --hook-type commit-msg
```

## Layout

- `src/main.ts` routes `?game=kart` and `?game=shooter`; with neither, it
  shows the start screen (`src/picker.ts`).
- `src/logic/`: pure game logic (tickets, runbooks, gates, laps, karts, race).
- `src/render/`: three.js scene. `src/ui/`: DOM screens and HUD.
- `src/logic/runbooks.ts`: the ticket types, for both games. Anyone can edit
  it.
- `src/shooter/`: Zero Down. `logic/` is its pure logic (floor, movement,
  the shift); `render/` is the three.js scene; `ui/` holds the screens and
  the HUD; `game.ts` is the loop and the debug hooks. It imports the shared
  pieces (`ops.ts`, `runbooks.ts`, `ticket.ts`, `rng.ts`) from `src/logic/`
  and never copies them.
- `tests/`: Vitest, one file per logic module; `tests/shooter/` for Zero
  Down. `e2e/`: Playwright.
- `scripts/`: repo guards, tested in `tests/`.

## Rules for this repo

- **`src/logic` and `src/shooter/logic` never import three or touch the
  DOM.** Unit tests run them in Node. ESLint enforces the rule for both
  folders.
- **Every push to `main` deploys the live site.** CI checks, runs the smoke
  tests, then publishes to Pages.
- **Delivery:** push to `main` until the game has real users (baseline
  decision D1).
- **Version:** `package.json` only. The title screen reads it through
  `__APP_VERSION__`.
- **No runtime third-party requests:** no CDN, no web fonts, no analytics.
- CI runs on the self-hosted Linux runner, on push to `main` only, so a fork
  pull request never reaches it.

## Policies

- Make minimal, focused changes; avoid broad refactors unless requested.
- Preserve existing architecture and patterns.
- Don't introduce new dependencies without justification.
- Update tests when behavior changes; update docs when user-visible
  behavior, configuration, or workflows change.

## Guardrails

- **Public repo.** No hostnames, LAN IPs, private DNS names, home-directory
  paths or secret names in any file, commit or issue. `10.x` is allowed.
  `node scripts/check-public.mjs` checks the files. See
  [public-repos.md](https://github.com/evanwtf/baseline/blob/main/conventions/public-repos.md).
- **No agent session details.** No session URL, session ID, `Claude-Session:`
  or `Co-Authored-By: Claude` line in a commit, PR or file. The commit-msg
  hook refuses them. See
  [git-and-prs.md](https://github.com/evanwtf/baseline/blob/main/conventions/git-and-prs.md).
- **Original work only.** No names, characters, items, tracks, music or logos
  from any existing kart game or shooter. No real company or brand names,
  no real CVE numbers and no real vulnerability nicknames. See the
  anti-goals in each design.

## Reading table

| Before doing this                | Read                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pushing to `main`                | `~/git/baseline/conventions/git-and-prs.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/git-and-prs.md))   |
| Writing a file, issue or comment | `~/git/baseline/conventions/public-repos.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/public-repos.md)) |
| Changing CI                      | `~/git/baseline/conventions/ci.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/ci.md))                     |
| Changing hooks                   | `~/git/baseline/conventions/pre-commit.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/pre-commit.md))     |
| Writing docs or comments         | `~/git/baseline/conventions/writing.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/writing.md))           |
| Changing kart gameplay           | [the kart design](docs/superpowers/specs/2026-11-04-oncall-kart-design.md)                                                         |
| Changing Zero Down gameplay      | [the shooter design](docs/superpowers/specs/2026-11-05-oncall-shooter-design.md)                                                   |
