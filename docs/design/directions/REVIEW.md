# Step 3a verification record

Date: **2026-10-13**. Branch: the design-study branch. Scope: design studies only.

## Completed

| Check | Result |
| --- | --- |
| `npm test` | **22 passing design tests**: contract, contrast, fonts/licences, SVG hygiene, DOM/copy, generated outputs |
| `npm run design:check` | All ten HTML pages, index, token CSS and font CSS match their sources |
| `npm run tokens:check` | Existing production CSS remains current |
| Production source preservation | No change to `src/design/tokens.json` or `src/styles/tokens.css` from task base |
| `git diff --check` | No whitespace errors |
| Pin optimizer | All five SVG files optimized with installed SVGO, multipass |
| Font source | Exact Fontsource 5.3.0 packages; all referenced binaries exist, Latin only; package OFL 1.1 licences checked locally |
| Reveal content | Supplied draft copy retained; one material fact linked to the Met object record; no image or playable item added |
| Recap | Ten rows per frame, placeholder objects 02–10, points add to 21,480 |
| Network/resource boundary | HTML contains no script, iframe, image or canvas assets; fonts and CSS are local; museum source is an ordinary outbound link |

Palette checks include body/muted text on each relevant surface, button and badge
text, disabled text, focus/boundaries, and Kept/Made/guess/line colours against
water, land and landcover. Passing colour maths is not a complete WCAG audit.

## Not verified — do not treat as a visual sign-off

**Browser rendering is blocked in this execution sandbox.** Installed Chrome and
the available Chromium headless shell were tried. The latter failed during
launch with `bootstrap_check_in ... Permission denied (1100)` before loading a
page. Playwright's default browser revision is not installed. No screenshots,
rendered clipping check, keyboard walkthrough, reduced-motion browser test, or
screen-reader audit could be completed. DOM checks do not measure CSS layout.

`scripts/check-design-browser.mjs` is ready for a permitted browser environment:

```sh
npm run design:browser
# Or set MG_BROWSER_EXECUTABLE to an already installed Chromium executable.
```

It opens all ten pages from `file://`, checks the twenty fixed frames, text and
horizontal overflow, round/reveal vertical fit, target dimensions, focus and
reduced-motion styles, expands When feedback, and writes screenshots/report only
under ignored `.cache/design-review/`. It has not been reported as passing.
Inspect every full-size screenshot, especially the single-line phone map legend
and reveal's above-fold fit, before choosing a direction or integrating it.

## Hook and dependency limits

Git hooks were run normally, never bypassed. Noreply identity and tracked-path
checks were configured. The confidential-name denylist file was missing from
the clone and checked repository locations; the hooks explicitly printed
**`denylist scan SKIPPED`**. A path to the existing file was requested. This
record does not claim that the confidential-name scan passed. Supply the existing
denylist and rerun the repository's commit-range scan before integration.

The dependency install reported **7 high-severity advisories**. No automatic or
force audit fix was run; dependency security remediation is outside this visual
identity change. Their origin and exploitability were not investigated here.

At the task base there was no `npm test` script, playable content, or item-evidence
test suite. The added `npm test` runs design-only tests and must not replace the
eventual content/evidence checks during integration.

## Adoption is a separate step

No choice was applied to production. Map outlines are schematic, not OpenFreeMap
tiles or Natural Earth fallback data. Game controls, reveal animation and focus
handoff, analytics privacy behaviour, lightbox and clipboard logic are documented
states/specifications rather than implemented game features. No push or pull
request is part of this task.
