# Content guide

How MuseumGuessr's objects are chosen, recorded and checked. Every
`items:check` error links to a section here.

## Files

| File | What it holds |
|------|---------------|
| `data/items.json` | The live pool: the fixed set of 10 (played in file order, easiest first) or at least 30 objects that every game draws its 10 from. |
| `data/sample.json` | One start-screen example object; never a round. |
| `data/reserve.json` | Fully researched swap-ins. Their images are not committed. |
| `data/items.schema.json` | The JSON Schema all three files follow. |
| `data/regions.json` | The continent and UN M49 sub-region of every Kept and Made country. |
| `data/retired.json` | Ids taken out of the pool, with the date and reason; never reused. Optional until the first retirement. |
| `images/<id>.jpg` | One photo per pool object and for the sample. |

## Schema

Fields are grouped by question: `kept` (where it is kept today), `made` (where
it was made) and `when` (when it was made). Two fields serve the deck rules:
`difficulty` (see "Difficulty") and `object_type` (painting, print, drawing,
sculpture, vessel, textile, architecture or other). The TypeScript `Item` type is
generated from the schema with `npm run types`; `npm test` fails when it is
stale.

When the museum's own record gives more than one date, set `when` to a range
that covers every date it gives and explain it in `when.note` (one line,
shown in the reveal's When details); record the sources in `conflicts`.

## Evidence

An item without complete evidence does not ship. Every answer is checked
against the holding museum's own record and against Wikidata (collection P195,
location of creation P1071, inception P571, coordinates P625). When they
disagree, the museum record wins and the disagreement goes in `conflicts`.
`retrieved` is the date the sources were read (YYYY-MM-DD). All URLs use
`https://`.

## Rights

Two layers must both be free:

1. The artwork is in the public domain (ancient objects; paintings whose artist
   died more than 70 years ago).
2. The photo is free to use: CC0, public domain, PD-Art (a faithful photo of a
   public-domain 2D work) or CC BY / CC BY-SA. Photos of 3D objects need an
   explicit licence on the photo itself. `photo.author`, `photo.licence` and
   `photo.source_url` are shown in the game.

Museum open-access programmes (The Met, Art Institute of Chicago, Cleveland,
Rijksmuseum, Getty, National Gallery of Art, Smithsonian) come first, then
Wikimedia Commons. Non-commercial or no-derivatives licences are never used.

## Made

`made` is the place of creation named by the holding museum: in its record,
or in its own published texts (description, catalogue entry, artist page) that
place the work, or the artist's workshop, there when it was made. It is not
the place the work shows, not the find spot unless it was also made there,
and not a culture name. A place that rests only on other sources does not
count: use the level the museum names (item 05's museum names only France).
Items whose museum names only a culture, or gives an either/or place, do not
ship. `made.source_url` points at the museum text that names the place.

An excavated object whose museum records only its find spot, and nothing
suggests it was traded there, gets the region or country around that spot,
never city precision, with a `note` saying so ("Found in a royal tomb at Ur;
the museum names no workshop"). Trade goods keep the rule above: item 07 was
made in Athens and found in Italy.

- `precision` is `city`, `region` or `country`, matching what the record names.
- `lat`/`lng` are the Wikidata P625 coordinates of that place item, stored in
  `wikidata_url`.
- `note` (optional, up to 90 characters) is shown next to the Made score, for
  example "Shows Venice; painted in London".
- `full_marks_km` (optional) narrows the full-marks radius; it can never exceed
  the radius of its precision level (see README, Scoring).

## Dates

`start` and `end` are historical years: negative numbers are BCE and there is
no year 0 (`-1` is 1 BCE). Full marks go to any guess inside the range, so
never invent a single year from a range; `label` keeps the museum's own
wording. Both years must lie inside the year control (4000 BCE to 2000 CE).

Century conversion: "3rd century BCE" is `-300` to `-201`; "5th century CE" is
`401` to `500`; "about 420 BCE" with no range stays `-420` to `-420`.

## Alt text

`alt_neutral` is read by screen readers during the round, before the answer.
It describes material, form, figures and composition only: no title phrase,
artist, place, culture or date. Example: "Carved marble frieze: a winged figure
grapples with a bearded man; fragments missing at left". The title and full
credits appear at the reveal.

`caption` is the one short line shown on the photo during the round (10 to 70
characters, DS37): what the object is and shows, under the same rules as
`alt_neutral` (no title phrase, artist, place, culture or date). Example:
"Colour woodblock print: a huge clawed wave curls over three long boats". The
item check rejects place words, two-word title phrases and possible dates in
either field.

## Journey

`moved` is true when the holding city lies outside the made place. Every moved
item has a `journey_fact` (up to 240 characters) on how it reached its current
collection. Documented transfers carry their source; gaps are written as "not
documented". A neutral tone, and no claim the source does not make.

Every item gets a restitution search. An object under a public government or
community claim is marked `contested: true` and its `claimant_source` is shown
next to the museum's account.

## Heritage

`heritage_image_law` is true when the object is held in, or was made in, Italy
or Greece. Those countries restrict commercial use of images of their cultural
heritage; the flag marks items to revisit before any monetisation.

## Images

`npm run items:add-image -- <id> <url|file>` downloads the photo, rotates it
upright, converts it to sRGB, strips all metadata and resizes it to at most
1600 px and 250 KB. `--crop t,r,b,l` cuts fractions off each edge first (record
why in `photo.crop_note`). Photos must not show wall labels, signage, accession
numbers, watermarks, colour charts or a recognisable gallery room.

## Ids

Ids are opaque two- or three-digit strings (`07`, `112`), never derived from a
title or place, and never reused: a promoted reserve item keeps its own id,
and a retired id stays in `data/retired.json` so an old challenge link never
opens a different object.

## Pool

The pool is either the fixed set of 10 or at least 30 objects. The fixed set
plays in file order. From 30 objects on, every game draws its own 10 (unseen
objects first), and `items:check` proves that the pool splits into
floor(N / 10) valid decks, so a new player gets every fresh game the pool
allows. When it cannot, it names the reason first, for example "difficulty-1
count must be at least 3 x 3 decks" or "Kept city X holds k > decks + spare
objects". The deck rules live in `src/deck/config.ts`.

A valid deck: 10 different objects; rounds 1-3 are difficulty 1; rounds 4-10
are difficulty 2 or 3 (difficulty 1 there only when nothing else fits); at
most 3 difficulty-3 objects; no Kept city twice.

## Difficulty

`difficulty` is 1 (easy), 2 (medium) or 3 (hard). It starts as an editorial
call, confirmed on the batch contact sheet, and is recalibrated once players'
points exist. A difficulty-1 object must be recognisable and clear-cut: a
city-level made place, no record conflict and no contested claim. At least 30%
of the pool is difficulty 1 and at most 30% is difficulty 3. In the fixed set
of 10, rounds 1-3 are difficulty 1.

Recalibration: once an object has 30 or more first-encounter rounds in
`analytics/queries/difficulty.sql`, a mean of 2,000 points or more suggests
difficulty 1, 1,200-1,999 difficulty 2 and below 1,200 difficulty 3. The
agent proposes changes on the next batch contact sheet; the founder approves
them there.

## Spread

Fairness rules for the fixed set of 10: at least 6 holding cities with no more
than 2 items per city. For a pool of N >= 30 objects:

- no Kept city holds more than min(4, floor(N / 10)) objects;
- at least max(10, ceil(0.3 N)) Kept cities, on at least 4 continents;
- Made places cover at least min(8, ceil(N / 5)) UN M49 sub-regions;
- at least ceil(0.15 N) objects end before 500 CE and as many start after
  1700, and no century (by the midpoint of the date range) holds more than
  25%;
- at most half the pool are paintings.

In both cases a player who always guesses the same place or year must score
under 40% of that question's maximum. `items:check` prints the spread and the
baselines.

## Answer edits and saved games

A saved game and the "Review your 10" recap hold their own 10 objects. They
stay valid while the kept, made and when answers of those 10 are unchanged:
adding objects to the pool keeps them, and changing one of those answers drops
them, so the player starts a fresh game instead of being scored against an
answer they never saw. Text and fact edits never drop a game. Saves from the
fixed set of 10 carry over only while those 10 answers are the original ones.

## Sample

The start-screen example comes from `data/sample.json`. Its photo must be CC0
or public domain.

## Reserve

Reserve records are complete except for the committed image; `promote` fetches
the image from `photo.file_url` when the record moves into a round.

## Swap

Replace a pool item with a reserve record in 5 steps:

1. Pick a reserve record, for example `12`, and the pool item to replace, for
   example `07`.
2. Run `npm run items:swap -- 12 07`. It fetches and processes the image, puts
   record `12` where `07` was, moves `07` back to the reserve and deletes its
   image. If any check fails, nothing changes.
3. Run `npm test`.
4. Look at the new image and reveal text in `npm run dev`.
5. Commit `data/` and `images/` together.

To grow the pool, `npm run items:promote -- --ids 12,14` appends reserve
records and checks the whole new pool once; nothing changes on failure. To
take an object out for good (for example when its photo's rights are
withdrawn), `npm run items:retire -- 07 --replace 12 --reason "rights
withdrawn"` puts `12` in its place and records `07` in `data/retired.json`,
so the id is never reused. At the pool minimum a replacement is required; keep
at least two reserve records ready.

## Contact sheet

Each new batch goes to the founder as one contact sheet:
`npm run items:sheet -- --ids 16,17,18 --out sheet.jpg` renders the photo,
title, made place and date, kept museum and city, difficulty, type and photo
licence of every listed record (pool and reserve; reserve photos are fetched
from `photo.file_url`). Without `--ids` it shows the whole pool, then the
reserve. The founder approves or strikes records in one reply; only approved
records are promoted.

## Check items

`npm run items:check` (also part of `npm test` and the pre-commit hook when
`data/` or `images/` change) validates everything above. Each error names the
item, the field, the reason, the fix and a link to this page.

## Worked example

The sample record in `data/sample.json` is a complete, passing record: the
Met's human-headed winged lion from Nimrud (CC0 photo, made in Nimrud, kept in
New York, dated 883–859 BCE, with its documented journey via England).
