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
`scripts/`, `tests/`, `docs/`, `analytics/`, `.github/`, `.githooks/` and the
named root files listed in `scripts/lib/paths.mjs`. Private local directories
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
- The GitHub username and the Pages URL are approved exemptions.
- A term written as `=word` matches only as a whole word, for short names that
  also occur inside unrelated words (a city name, a package name).

## Build checks

`npm run check:build` inspects the built site in `dist/`: only the expected
files deploy (no tests, scripts, reserve data, dev fixtures or source maps),
asset URLs sit under `/museumguessr/`, the Content-Security-Policy allows only
the map tiles and the EU PostHog host, the build id in the page matches
`build.txt`, the PostHog chunk keeps its `posthog-` prefix, the main bundle
stays within its gzip budget (`scripts/lib/budget.mjs`: its size when the v1
deck work began plus 25%; if it fails, move the item data into a lazy chunk),
and no personal API key or dated tile URL is present.

## CI and deploy

The `verify-and-deploy` workflow runs on every push: commit identity and
paths, `npm test`, lint, build, build checks and the browser tests on the
built artifact. After a force push, whose replaced commit no ref holds any
more, the identity and path check covers every commit on the branch. Source maps are kept as a CI artifact, never deployed.

Deploys run only for `main`, and only when the repository variable
`PAGES_LIVE` is `true` or someone runs the workflow by hand with the exact
commit SHA to publish. Every action is pinned to a full commit SHA; the verify
job can only read the repository and the deploy job can only write Pages.

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

Before the repository exists on GitHub, `node scripts/release-scan.mjs --candidate`
scans what the publish step will push: HEAD's tracked files as one fresh
commit (no history). `--local` scans the full local history instead; earlier
commits may still hold names that were removed since, which is why the public
repository starts from a single fresh commit. `npm run verify` runs the
candidate scan.
