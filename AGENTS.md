# Agent rules

Rules for any coding agent working in this repository. This file is public;
keep it free of private names.

1. **Read `AGENTS.local.md` first** when it exists (it is git-excluded and
   holds local pointers).
2. **One writer at a time.** Before writing, check the git-excluded `.writer`
   file. If another writer holds it, wait. Otherwise create it with your name
   and the start time, and remove it when you are done. A lock older than 4
   hours whose writer is no longer running may be removed. Run
   `git pull --ff-only` before writing.
3. **No AI-generated images in game content.** Artwork photos are real,
   credited museum or Commons photos.
4. **Evidence rules.** An item without complete evidence does not ship. Run
   `npm test` before every content commit (it runs the item check).
5. **No confidential names** in code, content, docs, commit messages or
   branch names. The hooks scan for them; never use `--no-verify`.
6. **Commit identity** is the GitHub noreply address
   (see [docs/release.md](docs/release.md#commit-identity)).
7. Merge other writers' branches fast-forward only.

## Commands

| Command | Use it to | Needs |
| --- | --- | --- |
| `npm ci` | install dependencies and the git hooks | Node 24 |
| `npm run dev` | play locally at the root path | — |
| `npm test` | type check, generated-file checks, item check, unit and design tests | offline |
| `npm run lint` | ESLint and Stylelint | — |
| `npm run build` | build `dist/` | — |
| `npm run build:deploy` | build the tracked deploy profile (`deploy/profile.json`), as CI and the deploy do | — |
| `npm run check:build` | check the built site (move `dist/**/*.map` out first) | a build |
| `npm run test:e2e` | build and run the browser tests on five viewports | `npx playwright install chromium` once |
| `npm run verify` | run everything above in CI order, plus the Worker under `wrangler dev`, and rewrite `docs/verification.md` | installs `worker/` dependencies when missing; release-scan rows print SKIPPED without a denylist |
| `npm run release:check` | the release scan of the GitHub repository (`-- --dist dist` scans a build) | `.denylist`, `exiftool`, authenticated `gh` |
| `npm run deploy` / `rollback` / `live:check` / `cf:bootstrap` / `setup:check -- --deploy` | hosting on Cloudflare ([docs/ops.md](docs/ops.md)); founder's machine only, each outward step needs `--yes` | the founder's yes, credentials in the shell |
| `npm run items:check` / `items:new` / `items:add-image` / `items:promote` / `items:swap` / `items:retire` / `items:sheet` | work on content ([docs/content.md](docs/content.md)) | network for `add-image` and the reserve photos |
| `npm run tokens` | regenerate `src/styles/tokens.css` from `src/design/tokens.json` | — |
| `npm run types` | regenerate the item type from the schema | — |
| `npm run design:build` / `design:check` | regenerate or check the direction studies | — |

## File map

| Path | Holds |
| --- | --- |
| `src/main.ts`, `src/app.ts` | boot order and the screen controller |
| `worker/`, `wrangler.jsonc` | the museumguessr.com Worker (`/api/v1`), its tests and its own `package.json` with the pinned wrangler |
| `deploy/profile.json` | every public value of the deployed build |
| `src/api/`, `src/security/` | the API contract and limits; the security headers (meta CSP and `_headers`) |
| `src/ui/screens/` | start, round, reveal, end and the other screens ([docs/screen-spec.md](docs/screen-spec.md)) |
| `src/copy.ts` | every user-facing string, by key |
| `src/map/` | MapLibre map, bundled fallback map, pins |
| `src/scoring/` | scoring constants (`config.ts`) and rules; README "Scoring" mirrors them |
| `src/deck/` | deck rules (`config.ts`) and the planner that draws each game's 10 |
| `src/game/`, `src/state/`, `src/storage/` | the game reducer, saved state and its schema, guarded storage |
| `src/analytics/` | event catalogue, channels, the PostHog adapter ([docs/analytics.md](docs/analytics.md)) |
| `src/design/tokens.json` | design tokens, the single source for colours, type, spacing ([DESIGN.md](DESIGN.md)) |
| `src/styles/` | `app.css` (layout and look), generated `tokens.css`, `fonts.css` |
| `src/assets/` | pin glyphs, brand marks, share-image source, mini-map artwork |
| `data/`, `images/` | the 10 rounds, the sample, reserves, and their photos |
| `analytics/` | checked-in HogQL queries and the KPI funnel definition |
| `scripts/` | items CLI, hooks, build checks, release scan, verify |
| `tests/unit/`, `tests/design/`, `tests/e2e/` | unit tests, design checks, browser tests |
| `docs/` | content guide, screen spec, analytics, operations, release, audits, verification index |

## Definition of done

A change is done when:

- `npm test`, `npm run lint` and `npm run test:e2e` pass (or `npm run verify`
  shows every automated row passed);
- user-facing text lives in `src/copy.ts` and is named in
  `docs/screen-spec.md` when it belongs to a screen;
- styles use tokens only; a visual change was looked at on a phone (390×844)
  and a desktop (1280×800) viewport;
- a new rule has a test whose title states the rule in plain language, with
  its requirement ID in brackets;
- docs that describe the changed behaviour are updated in the same commit;
- the commit passed the hooks (identity, paths, confidential-name scan).
