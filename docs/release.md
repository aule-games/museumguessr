# Release safety

This repository will become public. The git hooks and the release scan keep
private names, private files and personal email addresses out of it.

## Setup

`npm ci` runs `prepare`, which sets `core.hooksPath` to `.githooks`.
`npm run setup:check` prints the hook, identity, denylist and Node status.

Never commit with `--no-verify`.

## Commit identity

Every commit's author and committer email must be a GitHub noreply address
(`<id>+<user>@users.noreply.github.com`). The pre-commit and pre-push hooks
reject any other address, and CI re-checks every pushed commit.

```sh
git config user.email "<id>+<user>@users.noreply.github.com"
git commit --amend --reset-author --no-edit   # fix the last commit
```

## Path allowlist

Only these paths may be tracked: `src/`, `data/`, `images/`, `public/`,
`scripts/`, `tests/`, `docs/`, `analytics/`, `.github/`, `.githooks/`,
`worker/`, `deploy/` and the named root files listed in
`scripts/lib/paths.mjs` (among them `wrangler.jsonc`). Private local directories
stay out of git. To add a new deliverable, add it to `scripts/lib/paths.mjs`
and to the fixture in `tests/unit/paths.test.ts`.

## Denylist

A list of confidential terms lives in a git-excluded file at `.denylist`
(one term per line, `#` for comments), or at the path in `$MG_DENYLIST`. It is
never committed or pasted anywhere.

- The hooks scan staged changes, commit messages and pushed commits. For a
  new branch, or a force push over a commit this clone never fetched, that
  is every commit no remote-tracking branch holds.
- When the file is missing, every hook prints `denylist scan SKIPPED` and the
  release check fails.
- A hit prints only "term #k of N" and a location, never the term.
- Matching ignores case and accents, and also finds the term written with
  spaces, hyphens, underscores, joined, or URL-encoded.
- The GitHub username and the public address (https://museumguessr.com/) are
  approved exemptions; the old Pages address stays exempt because the
  requirement ledger quotes it.
- A term written as `=word` matches only as a whole word, for short names that
  also occur inside unrelated words (a city name, a package name).

## Build checks

`npm run check:build` inspects the built site in `dist/`: only the expected
files deploy (no tests, scripts, reserve data, dev fixtures or source maps;
`_headers` and `404.html` are expected), asset URLs sit under the base path
`/`, the Content-Security-Policy allows only the map tiles and the EU PostHog
host, the `_headers` file carries exactly the values in
`src/security/headers.ts` and its CSP equals the meta CSP of `index.html` and
`404.html` apart from the header-only `frame-ancestors 'none'`, the 404 page
links home, the page declares its build purpose and a deploy-purpose build
ships no development fixture code, the build id in the page matches
`build.txt`, the PostHog chunk keeps its `posthog-` prefix, the main bundle
stays within its gzip budget (`scripts/lib/budget.mjs`: its size when the v1
deck work began plus 25%), the item records stay in their own lazy chunk
(`assets/items-*.js`; the main bundle carries only the item core built by
`scripts/lib/items-core.mjs`), the reveal, the tour, the menu overlays and
the end screen with its share block stay out of the main bundle in chunks
that load on demand (`src/ui/lazy.ts`), the main bundle imports no other
chunk statically, and no personal API key or dated tile URL is present.

## CI

The `verify` workflow runs on every push: the commit identity and path
check, then `npm run verify` (type checks, unit and Worker tests, lint, the
build and its checks, the local Worker suite and the browser tests). After a
force push, whose replaced commit no ref holds any more, the identity and path
check covers every commit on the branch. A missing prerequisite fails the run;
only the release scan may show SKIPPED there, because CI has no denylist.

No workflow deploys: there is no manual dispatch, no Pages job and no
Cloudflare secret in GitHub. Deploys run from the founder's machine with
`npm run deploy`, which refuses unless this check is green for the exact
commit ([docs/ops.md](ops.md#deploy-and-rollback)). Every action is pinned to
a full commit SHA and the job can only read the repository.

## Release scan

`npm run release:check` runs `scripts/release-scan.mjs` against the GitHub
repository named by `origin` (or `--github <owner/name>`). It clones a mirror,
so pull-request refs are included, and looks for every denylist term in:

- every file in every ref, under all its spellings (see [Denylist](#denylist));
- the metadata of every image and binary, read with `exiftool` (binaries are
  allowed only under `images/`, `public/` and fonts);
- commit messages, author and committer names and emails (every email must be
  a noreply address), branch and tag names;
- on GitHub: the description and topics, pull requests, issues and workflow
  names.

Prerequisites: the denylist, `exiftool` (macOS: `brew install exiftool`) and
an authenticated `gh`. A hit prints only "term #k of N" and where; the scan
exits 1. A missing prerequisite or unreadable object prints
`scan incomplete` and exits 2, never a zero-hit line. A clean run ends with
the audit line:

```text
denylist check: N terms, 0 hits (commit <sha>, incl. PR refs)
```

`node scripts/release-scan.mjs --dist <dir>` (or `npm run release:check --
--dist dist`) scans a built output on its own: every file's name and text and
every binary's metadata. `npm run deploy` runs it on the exact deploy build
before anything remote changes, and `npm run verify` runs it on the verify
build when the denylist is present.

Before the repository exists on GitHub, `node scripts/release-scan.mjs --candidate`
scans what the publish step will push: HEAD's tracked files as one fresh
commit (no history). `--local` scans the full local history instead; earlier
commits may still hold names that were removed since, which is why the public
repository starts from a single fresh commit. `npm run verify` runs the
candidate scan.

## Dependency audit

Recorded 2026-10-22 (`npm audit` at the repository root and in `worker/`):

- `worker/` (wrangler 4.151.0): 0 vulnerabilities; every package carries a
  verified registry signature.
- Root: 7 high findings, all one advisory, GHSA-vfj7-8cjw-p6xm (`braces`
  ≤ 3.0.3, stack exhaustion on deeply nested brace patterns). It reaches the
  tree only through `stylelint` 17.16.0 (via `micromatch`, `fast-glob` and
  `globby`), a development-only lint tool whose patterns come from this
  repository's own config. No runtime dependency and nothing in the built site
  includes it, so it is no risk to players. No fixed `braces` release exists;
  the first `stylelint` without it is 18.0.0-next.0, a prerelease published
  2026-10-22, which the 7-day minimum release age on this machine's npm blocks.
  Recheck when a stable `stylelint` 18 is at least 7 days old, then update
  `stylelint` and `stylelint-config-standard` together and run `npm run lint`.
  A unit test keeps every `braces` copy in the lockfile development-only.
