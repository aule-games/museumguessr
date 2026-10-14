# Content guide

How MuseumGuessr's objects are chosen, recorded and checked. Every
`items:check` error links to a section here.

## Files

| File | What it holds |
|------|---------------|
| `data/items.json` | The 10 rounds, in play order (easiest first). |
| `data/sample.json` | One start-screen example object; never a round. |
| `data/reserve.json` | 4-5 fully researched swap-ins. Their images are not committed. |
| `data/items.schema.json` | The JSON Schema all three files follow. |
| `images/<id>.jpg` | One photo per round and for the sample. |

## Schema

Fields are grouped by question: `kept` (where it is kept today), `made` (where
it was made) and `when` (when it was made). The TypeScript `Item` type is
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

`made` is the place of creation named by the museum record: not the place the
work shows, not the find spot unless it was also made there, and not a culture
name. Items whose record names only a culture, or gives an either/or place, do
not ship.

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

Ids are opaque two-digit strings (`07`), never derived from a title or place,
and never reused: a promoted reserve item keeps its own id.

## Order

Rounds play in file order. Rounds 1-3 use the most recognisable objects whose
made place is city-level and whose record has no conflicts.

## Spread

Fairness rules: the 10 rounds use at least 6 holding cities with no more than
2 items per city, and a player who always guesses the same place or year must
score under 40% of that question's maximum. `items:check` prints both.

## Sample

The start-screen example comes from `data/sample.json`. Its photo must be CC0
or public domain.

## Reserve

Reserve records are complete except for the committed image; `promote` fetches
the image from `photo.file_url` when the record moves into a round.

## Swap

Swap an item in 5 steps:

1. Pick a reserve record, for example `12`, and the round slot to replace, for
   example `7`.
2. Run `npm run items:promote -- 12 7`. It fetches and processes the image,
   puts record `12` into slot 7, moves the displaced record to the reserve and
   deletes its image. If any check fails, nothing changes.
3. Run `npm test`.
4. Look at the new image and reveal text in `npm run dev`.
5. Commit `data/` and `images/` together.

## Check items

`npm run items:check` (also part of `npm test` and the pre-commit hook when
`data/` or `images/` change) validates everything above. Each error names the
item, the field, the reason, the fix and a link to this page.

## Worked example

The sample record in `data/sample.json` is a complete, passing record: the
Met's human-headed winged lion from Nimrud (CC0 photo, made in Nimrud, kept in
New York, dated 883–859 BCE, with its documented journey via England).
