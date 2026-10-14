# MuseumGuessr design system

**Direction A, "Transit Index", is adopted (2026-10-13).** Production tokens in
`src/design/tokens.json` are A's copy, and `src/styles/app.css` applies A to the
built screens. Direction B, "Object Club", was not chosen; its study stays in
[the comparison](docs/design/directions/index.html) for the record.

Where the game differs from the static studies, on purpose:

- `layout.reveal-map` stays `32vh`: the game has no size container (see Tokens).
- The year slider keeps the game's three equal segments (4000 BCE–1 CE, 1–1000,
  1000–2000) and shows no thumb until the first touch, so no default year is
  ever implied. Tick labels put the era under the number so they never collide.
- The reveal keeps the top bar (round, running total, menu) above the wall label.
- On a phone in portrait, the reveal map hides its zoom buttons: the view is
  already fitted to every pin, and pinch or double-tap still zoom.
- On short landscape reveals, only World remains, at bottom-left. The fit
  reserves measured pin/label, control and attribution space; guessing-map
  controls are unchanged.
- Production is score-first: a compact wall label is followed immediately by
  scores, before the map and journey fact. The old static studies below retain
  their original order and are not the phone acceptance reference.
- On desktop and landscape, the reveal map and its legend fill the actual
  scrolling region's height, not the viewport minus an assumed footer height.
  The optional feedback row must not hide the legend.

The studies below are static, low-fidelity compositions, not a playable build.
All artwork and recap images there are patterned boxes labelled **photo**.

## Shared rules

### Layout regions

- **Phone rounds:** one fixed `100dvh` application viewport, no page scroll.
  The study represents it with an exact **390 × 844 px** frame. Rows are a
  **48 px** top bar, **56 px** prompt, photo/map in a **2:3** flex ratio, and
  **64 px + bottom safe area** action bar. There is exactly one primary action,
  **Confirm**. Do not put a competing Next or navigation action beside it.
- **Prompt:** three state dots identify Kept/Made/When; the active question is
  the heading, the round-one hint is the second line, and `?` occupies a 44 px
  target. On the compact phone composition the dots' names are available to
  assistive technology; desktop shows the names. Done uses a check, active is
  filled, todo is an outline. State is not communicated by colour alone.
- **Photo:** preserve the whole artwork on `color.matte`, using `object-fit:
  contain` in the eventual game. Never crop to fill. Tapping the photo opens a
  lightbox; the static study shows its explicit affordance only. In When, photo
  gets approximately 30% of the answer-content region; year controls take 70%.
  Short portrait screens keep these shares (2:3 for photo/map, 3:7 for When),
  rather than forcing the photo to a 96 px thumbnail. Year controls may scroll
  internally; Confirm must stay visible.
- **Desktop:** exact **1280 × 800 px** study. Rounds put the photo in the left
  55%, prompt/answer/Confirm in the right 45%. Reveal replaces that photo with
  the map. Production text is wall-label → scores → journey → facts → credit;
  the static study retains wall-label → journey → scores.
- **Reveal and end:** production retains the round top bar above the wall label.
  On phones the title uses 26 px, scores come next, then the map (about 32% of
  the viewport), legend and journey. All three collapsed rows and the total
  must fit above the action bar at 390 × 844 and 375 × 667 on reveal one;
  at least 48 px of the map must still show at 390 × 844. Credit is scrollable,
  not promised above the fold. Short landscape uses a 20 px title and visually
  leads the table with its total; rows scroll in the right panel. Expanding
  a score reason may scroll the reveal content, never cover Next. The end recap
  may scroll internally to retain all ten rows and the replay link. The outer
  comparison canvas intentionally scrolls horizontally: do not shrink frames
  to make them fit the review browser.

### Spacing, radii, and hierarchy

The shared spacing ladder is **4, 8, 12, 16, 24, 32, 48, 64 px** (`space.1–8`).
Use 16 px phone content gutters, 24 px for the start exhibit, and 24–48 px on
desktop. Use 8 px between related controls and 24 px between information groups.
Type and spacing use tokens, not arbitrary per-screen palette/font overrides.

Direction A radii are **0 / 2 / 4 px** (`sm/md/lg`); B uses **8 / 16 / 28 px**.
`radius.pill` is reserved for actual capsules/circles. A gets squared labels
and a strong cobalt edge. B gets rounded ticket surfaces and capsule actions.
Subtle stepped shadows use each direction's two shadow tokens; no glows.

### Wall label

This is a reusable **information structure**, not an ivory-paper visual style:

1. Object title (the reveal's primary heading).
2. Made place and date, including ranges and BCE/CE.
3. **Now in** museum and city. Kept means that city, not where the object was
   discovered, what it depicts, or a claimed rightful owner.
4. Photo credit, preserved even when the label is condensed for recap or share.

On the reveal, the first three fields are the header; the credit is the last
line before Next, after the scores, map, journey, and facts. The ten-row
end study deliberately uses the brief's compact title / Made in → Now in /
points layout; its thumbnail placeholders are not a substitute for production
credits. The game implementation must retain credits in recap detail and text
exports rather than silently discarding them.

Example share-label structure (specification, not wired clipboard behaviour):

```text
MuseumGuessr · 21,480 / 30,000 · Curator
Lamassu
Made in Nimrud, 883–859 BCE
Now in The Metropolitan Museum of Art, New York
Photo: The Metropolitan Museum of Art, CC0
```

### Map style and pin glyphs

Main map: **OpenFreeMap vector tiles**, using the **OpenMapTiles** schema.
Retain the quiet context layers below; no bright POI icons, satellite imagery,
or decorative terrain. All labels are English; select available English names
and omit untranslated labels rather than accidentally switching language.

| Layer / role | Tokens |
| --- | --- |
| Background, `water`, land/base fill | `map.background`, `map.water`, `map.land` |
| `landcover`, country `boundary`, minor boundary | `map.landcover`, `map.border`, `map.border-minor` |
| Optional low-emphasis roads and graticule | `map.road`, `map.graticule` |
| `place` labels, city labels, label halo | `map.label`, `map.label-city`, `map.label-halo` |

Fallback: **bundled Natural Earth land/country geometry**, with English city
labels as DOM markers. It must remain usable when vector tiles are unavailable.
Only rank-zero cities are eligible at world zoom; more ranks enter as zoom
increases. Rank-prioritized, measured label boxes keep an 8 px collision gutter
from each other and the controls/drop label/attribution. Labels cut by the map
edge are omitted. This does not alter snapping, answers or the place dataset.
Use the same map tokens and pin assets in both renderers. The static compositions
use intentionally schematic, hand-coded SVG outlines: they are neither real
tiles nor a bundled production fallback and must not be reused for scoring.

| Asset | Geometry / meaning |
| --- | --- |
| `kept.svg` | Square cabinet with a short anchored foot; filled answer |
| `made.svg` | Diamond; filled answer |
| `combined.svg` | Cabinet with diamond counterform; only for **exactly coincident answer coordinates** |
| `guess-kept.svg` | Hollow cabinet; player's Kept guess |
| `guess-made.svg` | Hollow diamond; player's Made guess |

Each file is SVGO-optimized, metadata-free SVG, with a `0 0 32 40` viewBox and
only `currentColor`/`none` paint. Inline SVG or a mask is required for CSS colour
inheritance; an external `<img>` does not inherit `currentColor` from its host.
Anchor at the bottom centre. Normal glyph width is `pin.size` (32 px), hollow
guess width is `pin.guess-size` (28 px), with a 2 px outline. An interactive
marker needs an invisible **44 × 44 px minimum** hit area without changing its
visible glyph. The larger schematic hollow overlay around a correct Kept answer
is intentional: it lets both states be visible at the same point.

Kept and Made retain different silhouettes in monochrome. On Made, leave the
confirmed Kept visible but subdued (`color.ink-muted`, not an opacity that drops
contrast below 3:1). A carry-over specimen appears below round-kept. `combined`
does **not** represent coincident guess/answer pins, or near-but-not-identical
answers. Label any combined answer explicitly “Made + Kept”. The wordmark pairs
the separate Made and Kept silhouettes; it does not use the combined glyph.

Reveal: one solid Made→Kept journey line (`color.answer-line`), explicitly
labelled **made here · held here now**; thin dashed guess-to-answer links
(`color.guess-line`). A full-marks co-located guess has a zero-length connector,
not a fake distance. Filled/hollow and shape form the one-line legend. The SVG
illustration is schematic: supplied 310 km / 120 years sample scores are not
calculated from its drawing coordinates.

### Reveal map emphasis

The reveal is a route diagram, not another guessing map. Hide base labels and
minor detail; fade the remaining map under a **78% surface-colour veil**. Fill
the answer countries with their Kept/Made ink at **28% opacity**, with an opaque
**2 px boundary**. The boundary carries small-country recognition; increasing
fill opacity instead would reduce pin and path contrast. Country outlines are
context, not the scoring boundary, and the existing full-marks area stays separate.

Journey lines remain solid at 3 px. Guess links remain dashed, now at 2 px.
Reveal pin glyphs have a surface-colour keyline, using `pin.stroke`, so an
outline or crossing path cannot merge with a pin. Keep hollow centres hollow.
Colour is supplementary: cabinet/diamond and filled/hollow shapes remain.

The legend uses the raised surface, a separating rule and normal line height.
In the split layout, `.reveal__scroll` is a size container; the sticky media
region is `100cqh`, with an auto-height legend and the map in the remaining
space. This includes the actual feedback/footer height. The portrait map
continues to use `layout.reveal-map`. Fitting keeps the same answer/guess
coordinates and maximum zoom, but measures the pin labels and visible controls
instead of assuming symmetric 56 px padding. Long pin labels wrap at 192 px.
The landscape World button sits below the fitted labels, clear of the legend;
desktop reserves its controls column on the right. No scoring geometry changes.

Contrast is checked on composited colours, including the veil, country tint
and full-marks area together, not just on the base palette. Run
`node --test docs/design/reveal-tour.test.mjs`. Raster visibility of small
countries, line intersections and both map renderers still needs browser review.

### Year input

Show the large **1450 CE** readout, an initially empty numeric field, and both
**BCE | CE** labels in a 44 px segmented control. In the uncommitted study the
year is a preview, the thumb is an outlined dashed “ghost”, and Confirm is
disabled. Production must solidify the thumb and enable Confirm on first
deliberate pointer/keyboard edit or valid numeric input; never submit a default
year merely because the slider rendered. Native input controls in these static
studies illustrate states; no synchronisation or score logic is implemented.

Use piecewise-linear interpolation between these slider-position anchors:

| Track position | Year |
| --- | --- |
| 0% / 12.5% / 25% | 4000 BCE / 3000 BCE / 1000 BCE |
| 37.5% / 55% | 1 CE / 1000 CE |
| 72.5% / 100% | 1500 CE / 2000 CE |

There is no displayed year zero. Map input years into a continuous internal
ordinal for interpolation and back into historical notation for display.
Tick labels are the brief's 3000 BCE, 1000 BCE, 1 CE, 1000, 1500, 2000. Caption:
**Recent centuries get more room**. A museum date range scores full marks.
Expanded When feedback shows the actual date band and the player's marker.

### Motion and reveal choreography

The studies show the **final state** without playing motion. Production has
one finite sequence, no looping pulse, confetti, or animation-gated actions:

| Time from reveal | Action |
| --- | --- |
| 0–150 ms | Answer pins drop a short distance; `motion.fast` |
| 150–750 ms | Made→Kept line draws once; `motion.slow` (600 ms) |
| 750–1150 ms | All three score rows count up together; `motion.medium` (400 ms) |
| At 1150 ms | Focus score summary with `preventScroll: true` |

Total: **1,150 ms**, below 1.2 s. Use `motion.ease-standard`; reserve
`motion.ease-exit` for dismissal. Set the final accessible score immediately;
do not announce every count-up frame. The score wrapper has `tabindex="-1"`.
**Next round works from time zero**: cancel queued animation and pending focus
when the player advances. Never move focus back from Next if the player has
already interacted. A 1,000-point row explicitly says **Spot on**.

Under `prefers-reduced-motion: reduce`, render all final positions and scores
immediately, skip counting/drawing, and focus the score once if still on that
reveal. No delay, smooth scroll, animated lightbox, or transitional resize.
The study stylesheet globally disables animation/transitions in this mode.

### Accessibility and state rules

- **WCAG AA:** text at least **4.5:1**; control boundaries, focus and pins at
  least **3:1**. Do not trade smaller text for a lower contrast requirement.
  Both palettes also keep disabled text above 4.5:1 despite its exemption.
- **Targets:** at least **44 × 44 px**; the entire score-row summary is a
  target. In the game a button expands one reason; When adds the timeline. New
  game, map controls, era choices, and optional-feedback choices have the same
  minimum. No hover-only essential information.
- **Focus:** `focus.width = 3px`, `focus.offset = 2px`, `color.focus`, visible
  on keyboard focus. Segments keep overflow visible and a surface-colour gap
  around the external ring so it does not disappear on a selected fill; programmatic
  score focus uses the same visible outline. Focus order follows reading order;
  the map is not a keyboard trap. Live modal focus/return needs implementation.
- **Optional feedback:** the difficulty row exists **after round 3 only**,
  directly above Next; it is not on the round-one reveal. The below-frame
  specimen shows that variant. “Most fun” is optional at the end. No selection
  blocks progress, and no selection is prefilled. Show the test badge once on
  each direction's phone start frame, not duplicated on desktop.
  Production uses the shorter `pulse.difficulty` label and 8 px chip gutters
  so label and three choices share one line at 375 px. Targets stay 44 px high;
  enlarged text can wrap instead of clipping. End feedback is unchanged.
- **Honest states:** Confirm is enabled only with an explicit answer. “Copied”
  in the end composition is the successful-copy state, not evidence that a
  clipboard write happened. Production displays it only after write success.
  Static study buttons do not pretend to start rounds or send events.

### Reveal score table

Treat the three answers and final total as one squared catalogue table, within
the normal content gutters. Phones use **question above result / 88 px points**:
the result gets the whole left column, with no ellipsis. At desktop widths use
the **96 px question / flexible result / 88 px points** grid (`space.8 + space.6`,
`1fr`, `space.8 + space.5`). Results may wrap; the points column never borrows
their width. It accommodates **1,000** in 20 px bold numeric type with 12 px
gutters. Rows are at least 48 px tall; the phone stack grows for complete text.

Keep the question glyph and a persistent disclosure chevron beside its name.
The chevron reverses when expanded. The whole row is the target on touch and
keyboard; the tinted, ruled points column is not a separate button. Full marks
retain the explicit **Spot on** result, success ink and success-tinted points
cell, rather than relying on the tint alone.

The total is the final row, with a cobalt top rule, raised background, uppercase
label and a white numeric cell. On short landscape, CSS places that same total
first with its cobalt rule below; it is not a duplicated live region and stays
last in DOM reading order. Its existing 3 px / 2 px focus ring remains visible;
do not clip the table's overflow to obtain square corners.

On hover-capable devices, show the tooltip as an **attached explanation strip
below its row**, in normal scroll flow. Inverse ink, 14 px body type and normal
line height separate it from results; its heading has its own line. This is
deliberately not an absolutely positioned bubble above the row, which can be
cut off by the scrolling column. Tap still expands the existing inline reason
and any timeline/note, replacing the hover strip. Long explanations scroll
with the reveal, never overlay the sticky forward action. Round-one portrait
acceptance requires the complete collapsed table above the action bar. Long
titles elsewhere and enlarged text may scroll; never truncate the identity or
result to simulate a fit. Short landscape requires a visible total and
scroll-reachable score rows, not an unreadably compressed table.

### First-visit tour

The tour uses the same squared catalogue card as the reveal: white surface,
1 px rule, 4 px cobalt top edge, condensed title, body-face explanation and
stepped shadow. Width is at most **384 px** (`space.8 × 6`), leaving at least
12 px to each viewport edge. Height is bounded by the dynamic viewport with
the same gutters; long content scrolls inside the card instead of clipping
its controls. Placement first tries below/above/beside the target. If that fails,
it can narrow to a free side column of at least 280 px, or cap its scrolling
height to a free vertical region of at least 160 px, before choosing the screen
edge with least overlap. The small-phone map step and landscape photo step
must not cover their target. These dimensions derive from the spacing ladder.

The numeric **Step n of 7** label is the accessible progress indicator. A small
cobalt rail mirrors the seven existing step keys; it is decorative and updates
immediately. If the step list changes, update the rail selectors and its offline
contract check together. Do not replace the count with colour-only progress.

A ruled footer groups Skip separately from Back and Next. Forward actions have
a 96 px minimum width; all targets remain at least 44 px high. Both groups can
wrap on narrow screens rather than compressing labels or hiding Skip. Preserve
the normal keyboard focus ring, including during programmatic step focus.

The spotlight has a 2 px cobalt inner boundary and 3 px surface-colour outer
boundary over the existing scrim. Only its geometry transitions, once per step
using `motion.fast` (150 ms); the card and progress do not slide or pulse.
Reduced motion suppresses spotlight transitions through both the existing still
class and the global media rule. Step count, focus order, dismissal, events and
completion behaviour stay unchanged. The Confirm copy says the year controls
appear only on When; it does not claim the current spotlight demonstrates them.

## Tokens

**`src/design/tokens.json` is the single source of truth for production.**
`npm run tokens` regenerates **`src/styles/tokens.css`**. `npm run tokens:check`
checks that generated CSS is current. Do not edit generated CSS directly.

Each direction has a full copy in `docs/design/directions/<a|b>/tokens.json`,
preserving every group, key, and value type. Production now holds A's values
(`placeholder: false`), except `layout.reveal-map` as noted above.

`npm run design:build` generates the ten HTML files, index, each direction's
`tokens.css`, and Latin-only `fonts.css`. `npm run design:check` detects drift.
Composition templates live in `scripts/design-directions.mjs`; shared geometry
and direction-specific treatments are in `docs/design/directions/compositions.css`.
All CSS custom properties used there belong to the supplied contract. No new
token keys or private CSS theme variables have been introduced.

**Contract limits:** fixed review dimensions (390×844 / 1280×800), 55:45 and 2:3
grid proportions, media breakpoint, SVG drawing coordinates, one-pixel border
geometry, tick positions and line dash pattern are structural constants; no
existing token describes them. They stay in composition CSS/generator rather
than overloading an unrelated token. Timing offsets are derived from the three
motion tokens, not extra token names. `layout.reveal-map` is `32cqh` in these
copies: the fixed frames are size-query containers, so 32% refers to the phone
frame, not the much taller side-by-side review browser. Production's existing
`32vh` remains untouched. If the adopted runtime uses a viewport rather than a
size container, resolve this unit explicitly during adoption.

## Direction A — Transit Index

**Look:** a light, cool-blue museum wayfinding system: condensed upright
headlines, squared catalogue labels, cobalt navigation bars, and tabular
numbers. The object is the exhibit; the UI is the locating equipment. It is not
cream/serif/terracotta, a dark neon dashboard, or an italic broadsheet. Its square
and diamond markers, blue/plum distinction, and wall-label hierarchy avoid
red/white teardrop-map branding and a generic history-quiz skin.

### Palette and measured contrast

| Role | Value / pairing | Ratio |
| --- | --- | --- |
| Ground / surface / raised | `#e9f0f4` / `#ffffff` / `#dce7ef` | Surfaces, not semantic boundaries |
| Main ink | `#142d49` on white | **13.99:1** |
| Muted ink | `#455d72` on ground / raised | **5.96 / 5.46:1** |
| Primary action | White on `#234fba` | **7.24:1** |
| UI border | `#637a8b` on raised | **3.57:1** |
| Focus | `#99316a` on ground | **6.07:1** |
| Disabled | `#455d72` on `#d4dce3` | **4.95:1** |
| Test badge | White on `#455d72` | **6.86:1** |
| Kept / journey | `#234fba` on water / land / landcover | **4.96 / 6.35 / 5.62:1** |
| Made | `#8b3653` on water / land / landcover | **5.23 / 6.69 / 5.92:1** |
| Hollow guesses | `#243747` on water / land / landcover | **8.39 / 10.75 / 9.51:1** |

Map water **#c9d8df**, land **#edf1ed**, landcover **#dce5dc**. Success is
**#186141**; matte is neutral **#dce0e3**. The complete palette, including map
labels, boundaries, warning and danger, is in A's token copy. Ratios use WCAG
relative sRGB luminance, not an estimated visual contrast score.

### Type and licences

| Token / use | Family / values |
| --- | --- |
| `font.display` | **Barlow Condensed**, bold 700; upright, often uppercase |
| `font.body` | **IBM Plex Sans**, regular 400 / medium 500 / bold 700 |
| `font.numeric` | **IBM Plex Mono**, regular 400 / medium 500 / bold 700 |
| `text.xs / sm / md / lg` | **12 / 14 / 16 / 20 px** |
| `text.xl / 2xl / 3xl` | **26 / 36 / 52 px** |

Tight/normal line height: **1.15 / 1.45**. Tracking: **−0.01em / 0 / 0.06em**.
The desktop start headline combines the display and xl tokens (78 px) without
introducing a new size key. Body text is never set in the condensed face.

All packages are exact **5.3.0**, licensed **SIL Open Font License 1.1**:

- Barlow Condensed: © 2017 The Barlow Project Authors. Credit and licence:
  [`@fontsource/barlow-condensed/LICENSE`](node_modules/@fontsource/barlow-condensed/LICENSE).
- IBM Plex Sans: © 2019 IBM Corp. Credit and licence:
  [`@fontsource/ibm-plex-sans/LICENSE`](node_modules/@fontsource/ibm-plex-sans/LICENSE).
- IBM Plex Mono: © 2017 IBM Corp. Credit and licence:
  [`@fontsource/ibm-plex-mono/LICENSE`](node_modules/@fontsource/ibm-plex-mono/LICENSE).

Only **Latin normal WOFF2** files are referenced in `a/fonts.css`. There is no
Google Fonts call or package-wide CSS import. Retain the OFL notices if binaries
are later copied from node_modules into a public runtime asset directory.

## Direction B — Object Club

**Look:** a lilac, forest-green contemporary museum activity ticket: expressive
upright grotesque type, mint wall-label panels, softly rounded containers and
capsule buttons. The little Example tag has a restrained printed-sticker tilt;
the rest stays aligned for play. The bright ground is purple rather than cream,
the typography is not serif/italic, and the accent is dark green rather than
neon on black or yellow on a stock dark UI. The silhouette system and exhibit
ticket framing are not GeoGuessr red/white pins or an EraGuessr-like chronology
skin; the journey remains the principal visual idea.

### Palette and measured contrast

| Role | Value / pairing | Ratio |
| --- | --- | --- |
| Ground / surface / raised | `#eae3f5` / `#faf7ff` / `#d8efdf` | Surfaces, not semantic boundaries |
| Main ink | `#342443` on surface | **13.39:1** |
| Muted ink | `#665371` on ground / raised | **5.53 / 5.70:1** |
| Primary action | White on `#255c48` | **7.77:1** |
| UI border | `#81728d` on raised | **3.67:1** |
| Focus | `#7041ab` on ground | **5.54:1** |
| Disabled | `#665371` on `#d5cfde` | **4.54:1** |
| Test badge | White on `#543b77` | **9.26:1** |
| Kept | `#255c48` on water / land / landcover | **5.65 / 6.63 / 5.97:1** |
| Made | `#873768` on water / land / landcover | **5.50 / 6.45 / 5.81:1** |
| Hollow guesses | `#342443` on water / land / landcover | **10.32 / 12.11 / 10.91:1** |
| Journey | `#4e356a` on water / land / landcover | **7.48 / 8.78 / 7.91:1** |

Map water **#d6dce9**, land **#eceee4**, landcover **#dde4d6**. Success is
**#255c48**; matte is neutral **#e0dde5**. The muted map palette is deliberately
less chromatic than the framing UI. Remaining palette values are in B's copy.

### Type and licences

| Token / use | Family / values |
| --- | --- |
| `font.display` and `font.body` | **Bricolage Grotesque**, 400 / 500 / 700, upright |
| `font.numeric` | **IBM Plex Mono**, 400 / 500 / 700 |
| `text.xs / sm / md / lg` | **12 / 14 / 16 / 20 px** |
| `text.xl / 2xl / 3xl` | **26 / 36 / 48 px** |

Line heights and tracking match the shared system. B uses sentence case and
more open forms rather than A's condensed capitals. The desktop display size
is 74 px (3xl + xl); small information stays in the body face, not a novelty font.

Both packages are exact **5.3.0**, **SIL Open Font License 1.1**:

- Bricolage Grotesque: © 2022 The Bricolage Grotesque Project Authors. Credit and
  licence: [`@fontsource/bricolage-grotesque/LICENSE`](node_modules/@fontsource/bricolage-grotesque/LICENSE).
- IBM Plex Mono: © 2017 IBM Corp. Credit and licence above.

Only **Latin normal WOFF2** files are loaded locally by `b/fonts.css`. No remote
font requests, generic default font as the intended face, or proprietary font.

## Verification boundary

`npm test` checks the token key/type contract, WCAG colour pairs, SVG hygiene,
font paths/licences, exact draft copy, two frames per page, ten recap rows, total
arithmetic, absence of raster/script assets, and generation drift. `npm run
design:browser` is the separate Chromium layout/target/focus/screenshot check.
Tests at this bootstrap stage are **design checks**, not an item-evidence suite:
no playable item data or artwork evidence was added. See the dated
[review record](docs/design/directions/REVIEW.md) for executed checks and limits.


## Brand assets and static mini map — 2026-10-13

The text wordmark now links the separate plum Made diamond and cobalt Kept
cabinet, in that order. Both glyphs are decorative; MuseumGuessr remains real
Barlow Condensed 700 text. The favicon repeats that pairing on the cool-blue
ground. It never uses the coincident-answer combined glyph.

`public/favicon.svg` is the common raster source. Run `node scripts/og.mjs
--icons` to optimise the SVG and rebuild its 32×32 PNG and 180×180 touch icon
with resvg. The committed PNGs are tested against that source.

The start mini map uses simplified bundled Natural Earth 1:110m geometry,
not guessed coastlines. `node docs/design/generate-world.mjs` rebuilds
`src/assets/maps/world.svg` (11.4 KB gzip). It is decorative, not scoring data.
The static map recentres around the shortest longitude interval, including
antimeridian crossings, and has north-pole headroom for the anchored glyphs.
Land, water, graticule and journey use the existing map/colour tokens.

Exact README credit line:

> Mini-map land geometry: Natural Earth, 1:110m countries (public domain), simplified for display.

## Share image

The 1200×630 card is authored in `src/assets/og/share.svg`. The build plugin
renders it to `dist/og.png` using `scripts/og.mjs`; the PNG is not committed.
It contains the whole existing sample photograph, the Nimrud → New York
journey, the separate Made/Kept pins, and the credit on the card itself.

Font files are explicit, with system-font loading disabled. The native resvg
loader does not accept the installed WOFF2 files. The renderer restores the
same installed Fontsource WOFF1 tables to temporary TTFs in
`node_modules/.cache/share-fonts/`, using Node's built-in zlib and the
[WOFF container specification](https://www.w3.org/TR/WOFF/). No new dependency,
font design, system font, or network fetch is introduced. The fonts retain
their existing OFL licences. Tests check glyph rendering and sfnt checksums,
not just the existence of a PNG, to catch silent missing text.

Exact README credit line:

> Share image photo: The Metropolitan Museum of Art, CC0 1.0 — Human-headed winged lion (lamassu), https://www.metmuseum.org/art/collection/search/322609.

The map in the share card uses the same public-domain Natural Earth geometry.
No design-token values or names changed for these assets.

## Built-screen polish review

The [2026-10-13 review record](docs/audits/2026-10-13-visual.md), continued on
2026-10-14, distinguishes inspected raster assets and source-confirmed CSS
fixes from the **blocked** browser review. The score keeps its 3px/2px focus
ring, now around a padded catalogue cell. Phone When controls align toward the
photo; test mode reserves a dedicated diagnostic rail; dialog bodies scroll
beneath a fixed header; the compact portrait rule no longer overrides landscape.

Run `npm run build && npm run design:review:built` where Chromium may launch,
then inspect `test-results/visual/`. This does not replace the unchanged E2E
suite. No token values or dependencies changed. Do not treat the visual
review as passed until the browser matrix is actually inspected.
