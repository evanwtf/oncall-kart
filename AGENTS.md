# oncall-kart

A browser kart racer where the race is the on-call queue. You close hardware
tickets by driving through operation gates in runbook order. It is for team
fun. TypeScript, Vite and three.js; static files on GitHub Pages.

Live site: <https://evanwtf.github.io/oncall-kart/>.
Design: [docs/superpowers/specs/2026-11-04-oncall-kart-design.md](docs/superpowers/specs/2026-11-04-oncall-kart-design.md).
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

- `src/logic/`: pure game logic (tickets, runbooks, gates, laps, karts, race).
- `src/render/`: three.js scene. `src/ui/`: DOM screens and HUD.
- `src/logic/runbooks.ts`: the ticket types. Anyone can edit it.
- `tests/`: Vitest, one file per logic module. `e2e/`: Playwright.
- `scripts/`: repo guards, tested in `tests/`.

## Rules for this repo

- **`src/logic` never imports three or touches the DOM.** Unit tests run it
  in Node. ESLint enforces the rule.
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
  from any existing kart game. No real company or brand names. See the
  anti-goals in the design.

## Reading table

| Before doing this                | Read                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pushing to `main`                | `~/git/baseline/conventions/git-and-prs.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/git-and-prs.md))   |
| Writing a file, issue or comment | `~/git/baseline/conventions/public-repos.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/public-repos.md)) |
| Changing CI                      | `~/git/baseline/conventions/ci.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/ci.md))                     |
| Changing hooks                   | `~/git/baseline/conventions/pre-commit.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/pre-commit.md))     |
| Writing docs or comments         | `~/git/baseline/conventions/writing.md` ([GitHub](https://github.com/evanwtf/baseline/blob/main/conventions/writing.md))           |
| Changing gameplay                | [the design](docs/superpowers/specs/2026-11-04-oncall-kart-design.md)                                                              |
