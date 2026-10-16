# Screen spec

The contract between the screens, their copy and their layout. Every
user-facing string is a key in [`src/copy.ts`](../src/copy.ts); this file
names keys, not wording, so the copy has one home. Colours, sizes, type and
motion come from [`src/design/tokens.json`](../src/design/tokens.json)
(generated into `src/styles/tokens.css`); the visual direction is described in
[DESIGN.md](../DESIGN.md). Bracketed codes such as (DS19) are internal
requirement IDs; the sentence before each one is the rule.

## Rules for every screen

- **One forward action.** Each screen has one primary button, and it carries
  the arrow: Start, Confirm / Reveal answers, Next round / See results. Nothing
  competes with it in the action bar. (DS16)
- **Tokens only.** No raw colour or size outside the generated tokens; the
  stylesheet lint fails on hex, rgb() and named colours. (DS2)
- **Targets** are at least 44 × 44 px, including map buttons, era switches,
  chips, score rows and the invisible hit area around each pin. (A1)
- **Focus** uses the 3 px focus ring with a 2 px offset. On each new step,
  focus moves to the question; on the reveal, to the round score (and again
  after 1.2 s if focus was lost to the page). (A1)
- **Overlays** (menu, its dialogs, the photo lightbox) add one browser history
  entry, so Back closes them; game steps add none. An action chosen from an
  overlay runs only after the overlay's history entry has popped. (DS13)
- **Reduced motion:** with `prefers-reduced-motion: reduce`, the reveal shows
  its final state at once (no pin drop, no line drawing).
- **Text stays text.** Every string is set through text nodes, never HTML.

## Layouts and breakpoints

| Viewport | Round | Reveal | Start and end |
| --- | --- | --- | --- |
| Phone portrait (< 900 px wide) | Fixed rows, no page scroll: top bar 48, image 2fr, prompt 56, answer 3fr (min 220, the same for map and year), action bar 64 + safe area | Top bar, scrolling body, sticky action bar | One column, page scrolls |
| Short phone (portrait, height ≤ 700) | Keep the 2:3 photo/answer share on every step, with internally scrolling year controls | Compact wall label, then scores before the map | as phone |
| Landscape phone (height ≤ 500) | Photo left 55%, prompt/answer/action right 45% | Map left 55%, compact label and scores right; total visually leads the table | as phone |
| Desktop (≥ 900 px wide) | Photo left 55%, prompt/answer/action right 45% | Map left 55% (sticky), wall label and scores right | Two columns: text 45%, sample or recap 55% |

On phones every step splits the photo and the answer 2:3, so the year
control gets the same box as the map. Measure this share from the image box.
The content column is at most
1200 px wide and centred.
The E2E suite runs every layout check at 390×844, 844×390, 1280×800, 375×667
and 390×664 (an in-app browser).

## Start

Order (top to bottom; desktop puts the sample in the right column):

| Region | Content | Copy keys | Overflow |
| --- | --- | --- | --- |
| Wordmark bar | Made and Kept glyphs + name | `app.name` | one line |
| Intro | eyebrow, then the three-sentence headline, one sentence per line, the last set navy on a lime highlight | `start.eyebrow`, `app.tagline` | headline wraps by sentence |
| Sample card | the sample object's photo (whole object, never cropped) tagged "Example", over a static made→kept mini map | `start.example`, `start.sampleCaption` (mini map label) | photo `contain` on matte |
| Caption | sample title, made → now in, photo credit | `start.sampleCaption`, `reveal.credit` | wraps |
| Actions | see states | `start.*`, `challenge.*` | Start fills the width |
| Collection line | returning visitors: how many objects this device has seen (V1-15) | `end.collection`, `end.collectionAll` | wraps |
| Meta | the one-line expectation | `start.meta`, `challenge.meta`, `challenge.metaFriend` | wraps |
| Privacy | the privacy line + About & privacy link | `start.privacy`, `start.privacyLink` | wraps |

States:

| State | Actions region |
| --- | --- |
| New visitor, loading | Start disabled, reads `start.loading`, until the bundle is ready and photo 1 has loaded (at most 4 s) |
| New visitor, ready | Start (`start.start`) |
| Game in progress | Continue (`start.continue`, with the round; `start.continueChallenge` for a challenge game) + New game (`start.new`) |
| Finished visitor | `start.finished` (the last total), primary Play another 10 (`start.another`), secondary Review your 10 (`start.review`) when the snapshot still matches the pool, the collection line (V1-23) |
| No WebGL | `start.noWebgl` in place of Start (an alert) |
| Sample photo fails | the card keeps its matte placeholder; nothing else changes |

## Round (Made, When, Kept)

| Region | Content | Copy keys | Overflow |
| --- | --- | --- | --- |
| Top bar | round counter, running total, menu button, on the gallery wall; the running total sits in a white pill (the start and end brand bar matches) | `round.counter`, `round.total`, `menu.open` | one line, tabular numbers; counter and total share one face, size and weight |
| Prompt | the question first, then three step dots at the row end (done ✓, active filled, to do outline; dots only, names for screen readers), the step's rule as one short sentence under it, always shown | `step.*`, `q.*`, `hint.*` | question one line on phone; hint up to two lines |
| Photo | the object's photo, whole, on matte; a 32 px enlarge icon in its bottom-right corner (DS37); the whole photo is one lightbox button; the neutral `caption` is a visually hidden sibling `figcaption` for screen readers and shows under the enlarged photo; icon hides while loading or failed | `photo.open`; caption from item data | `contain`, never cropped; no text over the image; no row spent on the caption |
| Answer (Made, Kept) | the map with zoom in/out/World, the drop label top-left; on Kept the earlier Made guess remains hollow, muted and non-interactive, with a visible and accessible player-guess label beside it | `map.*`, including `map.previousGuess` | map fills the region |
| Answer (When) | year readout, year field + BCE / CE switch, error line, slider with ticks, caption | `year.*` | scrolls inside the region if needed |
| Action bar | secondary Back (from When on); primary Confirm on Made/When, Reveal answers on Kept | `back`, `confirm`, `confirm.last` | first action full width; thereafter Back left, primary fills remaining width, 8 px gap; both at least 44 × 44 px and fully on screen (DS36) |

Questions come in story order: Made, then When, then Kept (DS35). Nothing is
revealed until Reveal answers on Kept, so Back can reopen any earlier question
of the round (DS36).

The rule line is always shown; there is no toggle.
Short portrait screens retain the photo's share instead of a fixed thumbnail;
Back and the forward action stay on screen. (DS19) The bundled fallback map
admits only rank-zero cities at world zoom, adds ranks as zoom increases, and suppresses labels whose
measured boxes collide or leave the map. Guess labels and controls also reserve
space. This changes label visibility only, not pin placement or snapping. (DS4)

Map credits stay expanded even after panning, in 12 px body type on an opaque
surface. Preserve provider text and links, allow wrapping and never cover them
with zoom or World. The custom Natural Earth credit also covers reveal country
tints when vector tiles are active. This applies to both map modes. (DS22)

States:

| State | What shows |
| --- | --- |
| Photo loading | skeleton fill + `photo.loading`; Confirm disabled |
| Photo failed | `photo.failed` + Retry (`photo.retry`); after 3 retries also Skip (`photo.skip`) and `photo.skipNote`; skipping scores the round 0 |
| Map loading | a static frame with `map.loading`; taps do nothing |
| Map slow (> 4 s) or tiles fail | the bundled Natural Earth map, same tokens and pins |
| Map failed | `map.failed` + Reload (`map.reload`) |
| No pin yet | Confirm disabled |
| Pin placed | the hollow guess glyph, the drop label (`map.near` / country / `map.openSea`), announced (`map.pinPlaced`); Confirm enabled; the pin can be dragged |
| Kept step | the confirmed Made **guess** stays hollow and muted; `map.previousGuess` labels it as the player's guess, never an answer |
| Back pressed (DS36) | the previous question of the same round opens with its answer in place (pin, or year) as the draft; Confirm is enabled; a changed answer replaces the old one. Back is absent on the first question and gone once Reveal answers opens the reveal |
| Keyboard on the map | arrows pan, + / − zoom, Enter drops the pin at the centre crosshair, Escape leaves (`map.label`) |
| Year empty | readout "—", the slider handle mid-track but no value, Confirm disabled (no default year is ever submitted) |
| Year invalid | `year.noZero`, `year.notNumber` or `year.outOfRange` under the field; Confirm disabled |
| Year set | readout ("1200 BCE"), thumb shown, Confirm enabled |
| Confirm pressed twice | one answer is recorded |
| First visit, round 1 Made | the tour opens over the screen (see Tour) |

## Tour

A modal over round 1's first question (Made) on a first visit (no `museumguessr:v1:tour`
flag and no finished game), and from the menu on any round screen
(`menu.tour`). A spotlight lights one element at a time; the rest is under the
scrim and inert. The card sits below the lit element, else above, else beside
it, always fully on screen. Before overlapping a target, it can narrow into a
side column (at least 280 px) or scroll within the available vertical space
(at least 160 px). If no such space exists, it chooses the viewport edge with
the least target overlap. The 375×667 map step and 844×390 photo step must leave
their whole target uncovered. (DS34)

Visual treatment: rounded raised catalogue card, accent top rule, display-face
title, numeric progress count and decorative seven-step rail. The card is at
most 384 px wide with 12 px viewport gutters and a bounded, scrollable height.
Its ruled footer separates Skip from Back/Next; buttons wrap rather than
shrink below their touch targets. An accent/surface double boundary outlines
the spotlight. Only the spotlight geometry transitions (150 ms); reduced
motion suppresses it. Focus, step count, events and completion behaviour are
unchanged. `tour.confirm.body` explicitly says that the year controls appear
only on When; the Confirm spotlight does not claim to show the year control.
It names `confirm.last` as the final action, after which Back is no longer
available. Tour order and targets are unchanged by the photo-wrapper removal.

| Step | Lights up | Copy keys |
| --- | --- | --- |
| 1 | nothing (card centred) | `tour.welcome.*` |
| 2 | the photo | `tour.photo.*` |
| 3 | the prompt row (step dots and question) | `tour.questions.*` |
| 4 | the map | `tour.map.*` |
| 5 | Confirm | `tour.confirm.*` |
| 6 | the running total | `tour.score.*` |
| 7 | the menu button; Next reads `tour.start` | `tour.menu.*` |

Every card: `tour.progress`, Skip (`tour.skip`), Back (`tour.back`, not on
step 1), Next (`tour.next`). Skip, Escape and the browser's Back close it as
skipped; the last button closes it as done; either way the flag is set and
`tour_ended` is sent.

### Challenge link (V1-16 to V1-18)

A challenge link (`?d=<10 ids>&s=<score>&n=<name>&h=<deck hash>`) opens the
Start layout with its own line as the h1, in the body face and never
uppercased, with `app.tagline` above it as the eyebrow; focus goes to the h1.
The parameters leave the address bar once read; the challenge waits in
sessionStorage until Start, so a reload keeps it.

| Variant | h1 | Actions | Notes |
| --- | --- | --- | --- |
| Valid link | `challenge.line` with the name (or `challenge.friend`) and score; `challenge.lineNoScore` without a valid score; empty while the name is checked against the word list | primary Play the same 10 (`challenge.play`) | `challenge.changed` when the deck's answers changed since the link was made (no score to beat); `challenge.seenSome` when this device has seen some of the 10; meta `challenge.meta` / `challenge.metaFriend` |
| With a game in progress | as above | primary Play the challenge (`challenge.playChallenge`) opens Start over? (`confirmNew.*`); secondary Continue my game (`challenge.continueMine`) keeps the challenge for after that game | — |
| Broken link | `challenge.broken` | primary Play 10 objects (`challenge.brokenPlay`): a normal game | — |
| Reply result (the deck this device just finished, with a score) | `reply.line` with both totals and the result (`challenge.youWin`, `challenge.theyWin`, `challenge.tie`) | primary Play another 10 (`start.another`), secondary Replay these 10 (not ranked) (`reply.replay`) | — |

A name that matches the public word list (whole tokens) shows as
`challenge.friend`. Names render inside `<bdi>`, in the body face.

## Reveal

Phone order: compact wall label → score table (three rows, then the round
total) → map + legend → journey fact → contested claim (if any) → facts →
credit → sticky action bar. Desktop keeps the map in the left column and
uses wall label → scores → journey → facts in the right column.

At 390×844 and 375×667, all three collapsed score rows and the round total
must be above the action bar on round one's reveal; at 390×844 at least 48 px
of the map must remain visible too. On short landscape screens, the total
visually leads the table so it is visible before scrolling; the rows remain
reachable in the right-hand scroll region. DOM order keeps the total last,
and there is only one score live region. (DS21)

| Region | Content | Copy keys | Overflow |
| --- | --- | --- | --- |
| Top bar | as in rounds | as in rounds | one line |
| Wall label | set straight on the gallery wall, no block; object title in the display face; made place and date → now in museum, city; title uses 20 px on phones and short landscape, 26 px on desktop | `reveal.madeKept`, or `reveal.sameArea` when made and held in the same area | title and identity remain complete; no truncation |
| Journey | the sourced journey fact | `reveal.source` | wraps |
| Map | answer pins (filled), guesses (hollow), one made→kept line, dashed guess links, the full-marks area for a region or country origin; a 78% veil in the map's own ground colour fades the base map, with its labels hidden; answer countries have 28% Kept/Made tints and opaque 2 px outlines; every pin has a map-ground keyline and a soft shadow; kept pins are rounded squares with a museum icon, made pins round teardrops with a paintbrush, guesses the same shapes outlined | `reveal.madeRegion`, `reveal.lineLabel` | fitted with measured pin-label/control/attribution clearance; controls hidden in phone portrait, only World at top-left in short landscape, with a reserved left column; credit resizing re-fits until the player moves the map; pinch, double-tap and keyboard zoom remain; long pin labels wrap at 192 px (DS22) |
| Legend | raised caption rail under the map, normal line height; in the split layout map and legend fit the actual body height above the action bar, including feedback | `reveal.legend` | wraps; never reserved outside the map's available height |
| Score rows | Made / When / Kept (question order, DS35): glyph, name and disclosure chevron, the result (`result.km` / `result.years` with the difference in bold, or `reveal.spotOn`), a shared 88 px right-hand points column in large display-face numbers on the white rounded table (green when full marks); the round total row is a lime bar, navy text; on every viewport the name and points share the top line and the result runs full width below it; hover or keyboard focus (hover-capable devices) and tap cover the whole row (name, result and points) with the scoring explanation, white on ink, in the same place and with no heading; tap also opens the row's extras below (When's timeline, Made's place note) | `reveal.row.*`, `result.*`, `reveal.spotOn`, `reveal.kmCount`, `reveal.yearCount`, `reveal.yearOne`, `scoring.*` | each result stays on one line, its font stepping down to 11 px to fit, and only then wraps (never cut off or ellipsed); minimum 68 px rows; explanations scroll with the table, not over the action bar (DS31) |
| Round total | the table's final row, a lime bar: label + points out of 3,000 in navy (announced) | `reveal.scoreLabel`, `reveal.score` | one line; focus ring remains outside the cell |
| To beat (challenge games) | "To beat: 18,240" directly under the round total bar, never in the top bar (V1-21) | `reveal.toBeat` | one line |
| Contested | the sourced claim | `reveal.contested` | wraps |
| Facts | sourced facts | `reveal.source` | list |
| Credit | photo credit, photo source, museum record | `reveal.credit`, `reveal.creditSource`, `reveal.record` | wraps |
| Action bar | after round 3 only: `pulse.difficulty` uses a shorter question label; all three choices retain their wording and 44 px touch height; then Next round or See results | `pulse.*`, `reveal.next`, `reveal.results` | difficulty fits one line at 375 px at normal text size; enlarged text may wrap rather than clip; Next always visible (DS21) |

States:

| State | What shows |
| --- | --- |
| Full marks on a row | row on the full-marks fill, summary `reveal.spotOn` |
| Made and kept coincide | one combined glyph, labelled; the label line reads `reveal.sameArea` |
| Region or country origin | the pin, the shaded full-marks area, the place words |
| Skipped round | every row reads `reveal.skipped`, explanation `reason.skipped` |
| Museum gives more than one date | the When row's details show the item's date note (from the item data, not a copy key) above the timeline |
| Difficulty answered | the chips go, `pulse.thanks` stays; Next never waits for it |
| Reload on the reveal | the same reveal comes back |

## End

Order (V1-22): wordmark bar → total and tier (a challenge game adds both
totals and the result) → share block → Play another 10 → a waiting challenge →
collection line → Most fun → the 10-row recap → Replay these 10. Desktop:
summary and actions left, recap right. At 375×667 and 390×844 the total, tier
and Share are above the fold; at 390×844 Play another 10 is too.

| Region | Content | Copy keys | Overflow |
| --- | --- | --- | --- |
| Summary | total out of 30,000 and tier name, navy on a lime rounded panel like the reveal round total; a challenge game with a score adds "You 18,240 · Ali 19,000" and the result | `end.total`, `challenge.both`, `challenge.youWin`, `challenge.theyWin`, `challenge.tie` | one line on a phone |
| Share block | "Add a name" disclosure (opens the name field: label, helper, inline rule, Share without a name), the one lime primary Share with a share glyph (a challenge game: Send your score back), Copy link as a text link beside it, the polite status line, the manual-copy field with the link when the clipboard fails | `name.*`, `share.button`, `sendBack.button`, `share.copyLink`, `share.copied`, `share.copyManual` | Share fills the row |
| Play another 10 | full-width secondary | `end.another` | — |
| Waiting challenge | after "Continue my game": a link to the friend's challenge and Not now | `end.waiting`, `end.waitingFriend`, `end.waitingDismiss` | wraps |
| Collection line | how many objects this device has seen; hidden when storage is off | `end.collection`, `end.collectionAll` | wraps |
| Most fun | optional chips Made / When / Kept | `pulse.mostFun`, `step.*`, `pulse.thanks` | wraps |
| Recap | thumbnail, title, made → now in, points (or Skipped) per round | `end.recapRow`, `end.points`, `reveal.skipped` | title wraps |
| Replay | text link: the same 10 again (a replay, marked in its share text) | `end.replay` | — |

Share opens the Share your score chooser (WhatsApp, X, Copy link), which
returns focus to Share when closed. The browser's own share sheet is off for
now: on a Mac it opened the system share menu. WhatsApp and X get the hook and
the link, within 280 characters as X counts them, and no round-by-round
answers; Copy link copies the link alone. "Link copied" is announced only
after the clipboard write succeeds (V1-19).

A finished game saved under other answers shows the total and
`end.versionChanged` instead of the recap and the share block.

## Other screens and overlays

| Screen / overlay | Content | Copy keys |
| --- | --- | --- |
| Error | title; "Your progress is saved" when a saved game exists; Reload + New game; a reference line with the error name and build | `error.*` |
| Continued in another tab | title, body, Play here instead (takes the game over in this tab) | `tab.*` |
| Menu | How to play, New game (in a game only), Credits, About & privacy | `menu.*`, `app.name` |
| How to play | body + the three hints | `how.*`, `hint.*` |
| Credits | one row per photo with source links: during a game only the rounds already revealed and the sample, never a future round; after the game the whole deck (V1-24); map credit | `credits.*`, `reveal.creditSource` |
| About & privacy | what is sent, the event list, how `?test=1` stops sending | `about.*` |
| Start over? | body; Keep playing / Start over | `confirmNew.*` |
| Share your score | WhatsApp, X and Copy link as full-width buttons; closing returns focus to Share | `share.chooser`, `share.whatsapp`, `share.x`, `share.copyLink` |
| Photo lightbox | the full photo, pinch and zoom | `overlay.close` |
| Test badge (`?test=1` only) | "Test mode · analytics off"; expands to "Jump to the end (random answers)", which finishes the game in progress (or a new one) with random answers and opens the end screen, and the events that would have been sent | `test.*` |

## State reference

| Feature | Loading | Empty | Error | Success | Partial |
| --- | --- | --- | --- | --- | --- |
| Start | Start reads "Loading…" | — | error screen | Start / Continue | photo 1 still loading: Start stays "Loading…" (max 4 s) |
| Photo | skeleton fill | — | matte + Retry; Skip after 3 retries | photo | — |
| Map | static frame, "Loading map…" | — | bundled Natural Earth map; Reload if the map stops working | map | tiles slower than 4 s: bundled map |
| Pin step | — | Confirm disabled | — | "Near Berlin, Germany" | pin placed, not confirmed |
| Year step | — | field empty, no thumb, Confirm disabled | inline year-0 / not-a-number / out-of-range message | "1200 BCE" | — |
| Reveal | — | — | — | ordered reveal | an item without a journey fact fails the item check, so it never ships |
| Made and held in one area | — | — | — | combined glyph, "Made and held in the same area: …" | — |
| Region origin | — | — | — | pin + full-marks area + words | — |
| Difficulty row | — | row shown after round 3 | — | "Thanks", chips removed | — |
| Share | — | no name: Share without one | invalid name: inline rule, Share stays closed; clipboard fails: the link, selected | chooser; "Link copied" | chooser closed: nothing sent |
| Challenge link | h1 empty while the name is checked | no score: "Play the same 10 your friend played" | broken link screen | challenge line | answers changed: no score to beat |
| Resume | — | start screen | unreadable save: discarded, start screen | "Continue · Round 4 of 10" | a game left on a reveal resumes on that reveal |
| Error screen | — | — | "Something broke" + Reload + New game; adds "Your progress is saved" when a save exists | — | — |
