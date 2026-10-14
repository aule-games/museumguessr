# Two directions for MuseumGuessr

Open [index.html](index.html). Every screen contains a **390 × 844 phone** and a
**1280 × 800 desktop** frame side by side at their actual sizes. Scroll the outer
review canvas horizontally; do not judge the fixed compositions from a scaled
thumbnail. Dependencies must be installed for self-hosted fonts to load.

## A — Transit Index

A cool-blue wayfinding and catalogue system: Barlow Condensed capitals, IBM Plex
information typography, squared labels and a strong cobalt edge. Blue Kept
cabinets and plum Made diamonds make the museum/origin distinction visible in
both colour and silhouette. This is neither warm cream/serif/terracotta, dark
neon or stock black/yellow, nor an italic-serif broadsheet. The light blue working
surface, label-led reveal, and non-teardrop markers separate it from GeoGuessr's
red/white pin branding and a generic EraGuessr-style chronology quiz. It should
feel precise and immediately legible rather than luxurious or nostalgic.

## B — Object Club

A contemporary gallery activity ticket: lilac ground, dark forest-green actions,
mint information panels, expressive Bricolage Grotesque, rounded edges and a
small printed-sticker accent. The colour blocks and upright type keep it playful
without cream/terracotta editorial styling, neon-on-black or yellow dark UI, or
broadsheet hairlines and italic serifs. Cabinet/diamond markers and the
object-journey ticket are unlike GeoGuessr's red/white teardrop branding and
EraGuessr-like history-quiz framing. It should feel welcoming and tactile, not
like a dashboard or a default startup landing page.

## Static states

- **Start:** first-play frames, one test badge per direction, plus a separate
  returning-player button specimen below the comparison. No extra screen/frame.
- **Round Kept / When:** a placed Berlin guess enables Confirm; the When preview
  retains the ghost thumb and disabled Confirm. Below Kept is the Made carry-over
  pin and empty-answer state. These are state studies, not a working map/slider.
- **Reveal:** collapsed native score-row disclosures; When expands to a timeline.
  Round 3's optional difficulty controls appear in a separate below-frame action
  specimen, not on the round-one reveal. Next is never visually disabled.
- **End:** successful “Copied” state and exactly ten recap rows. Recap points sum
  to 21,480; objects 02–10 are clearly named placeholders, not invented museum
  content. The phone recap can scroll to its last row and replay link.

## How to play

Ten objects, the same for everyone. For each object, guess the city of the
holding museum (**Kept**), its place of creation (**Made**), and its creation
year (**When**). Each answer has up to 1,000 points: 3,000 per round, 30,000 total.
Made is not what an object depicts or automatically its excavation location.
These compositions do not implement rounds, scoring, map gestures, a lightbox,
storage, or clipboard writes; native disclosures and input focus can be explored.

## Credits

All visuals in these studies are **HTML/CSS/SVG code**, including patterned photo
placeholders and schematic maps. There are no raster images or AI-generated
artwork images. The Lamassu text is the supplied draft; its source link points to
the [Metropolitan Museum object record](https://www.metmuseum.org/art/collection/search/322609).
That record supports the date, Nimrud geography, gypsum-alabaster material, and
1932 gift. The photo credit is required draft copy; no photo is loaded here.
Font families, copyright credits, OFL licences, and colour ratios are recorded in
[DESIGN.md](../../../DESIGN.md). Do not treat this design study as content approval.

## About & privacy

The start screen reproduces the exact draft privacy copy. **These local studies
load no analytics and set no cookies.** They do not initialise PostHog or prove
the eventual application's privacy configuration. “Test mode · analytics off”
is an explicit state specimen. Clicking the museum source leaves the local study.

## Build and review

1. Run `npm run design:build` to regenerate the HTML and direction styles.
2. Run `npm test && npm run design:check && npm run tokens:check` for static checks.
3. Run `npm run design:browser` where Chromium is available; inspect all twenty
   screenshots in the ignored `.cache/design-review/` directory.

`MG_BROWSER_EXECUTABLE` may point to an already installed Chromium executable.
The generator never writes production tokens. Edit token copies for palette
changes; edit `scripts/design-directions.mjs` for HTML; edit `compositions.css`
for shared layout. [REVIEW.md](REVIEW.md) states what was actually verified.
