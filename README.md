# MuseumGuessr

Look at a real museum object, then guess where it is kept today, where it was
made, and when. A new ten every game.

**Play:** <https://museumguessr.com/>

[Run it](#run-it-locally) · [Change content](docs/content.md) ·
[Debug](#debugging) · [Release](docs/release.md) ·
[Metrics](docs/analytics.md) and [operations](docs/ops.md)

## How to play

Each round shows a photo of one object. Answer three questions in order:

1. **Made:** pin where it was made, not what it shows or where it was dug up.
2. **When:** type or slide the year it was made (BCE or CE; there is no year 0).
3. **Kept:** pin the city of the museum that holds it today.

Back reopens an earlier answer of the same round; nothing is revealed until you
confirm the last one.

The reveal shows the object's journey from where it was made to where it is
kept, with a sourced fact about how it got there; the map fades everything but
the two countries involved. Every answer scores up to 1,000 points, so a round
is worth up to 3,000 and a game up to 30,000. Hover or tap a score row to see
how its points were computed.

On a first visit a short tour points out each part of the screen; the menu
offers it again.

Keyboard: Tab into the map, move with the arrow keys, zoom with + and −,
press Enter to drop the pin at the centre, Escape to leave the map.

## About the objects

MuseumGuessr shows where objects are kept today, not where they belong. Some
were bought, some given, and some taken in war or under colonial rule. Where a
museum documents how an object left home, the game says so; where it doesn't,
the game says that too. We don't judge ownership claims; we point to the
sources.

## Scoring

All constants live in [`src/scoring/config.ts`](src/scoring/config.ts); a unit
test recomputes the examples below from them.

**Kept and Made** score by distance `d` (great-circle km) from your pin to the
answer. Inside the full-marks radius `r` you get 1,000; beyond it points fall
by a factor of e every 1,200 km (they halve about every 830 km):

```text
points = 1000                              if d <= r
points = round(1000 × e^(−(d − r) / 1200))  otherwise
```

For Kept, `r` is 50 km around the museum's city. For Made, `r` depends on how
precisely the place is known: 50 km for a city, 300 km for a region, 600 km for
a country (an object may set a smaller radius).

**When** scores by how many years your year is outside the museum's date range
(inside the range: 1,000). Older objects get a wider margin:

```text
margin = 45 + 0.17 × age        age = 2000 − middle of the date range, in years
points = round(1000 × e^(−years outside / margin))
```

Worked examples:

| Guess | Points |
| --- | --- |
| Kept, 500 km from the museum's city | 687 |
| Kept, 2,000 km off | 197 |
| Made, a region-level place, 800 km off | 659 |
| When, a painting dated 1884–1886, guess 1850 (34 years off, margin 64.55) | 591 |
| When, a sculpture dated 883–859 BCE, guess 1000 BCE (117 years off, margin 532.9) | 803 |

End-of-game titles: Visitor (from 0), Docent (7,500), Curator (15,000),
Keeper (21,000), Director (26,000).

## About & privacy

No cookies. Anonymous play counts via PostHog (EU).

There is no sign-up and nothing identifies you. To learn whether the game is
fun, the page sends anonymous play events to PostHog's EU servers in
cookieless mode: `$pageview`, `game_start`, `round_started`, `step_completed`,
`step_back`, `round_completed`, `game_completed`, `client_error`, `feedback`,
`result_shared`, `challenge_opened`, `challenge_completed` and `tour_ended`. Each carries game facts (round, step, points, the channel tag
from the link you followed) and the build id, plus the technical details
PostHog's library adds to every event: browser and version, operating system,
device type, screen and window size, language, time zone, the browser's
user-agent string and the site that linked here. Page addresses are sent
without their query string, except campaign tags (`utm_*` and `ref`). The full
list is in [docs/analytics.md](docs/analytics.md#events).

Your device remembers which objects you have seen, so your next game shows
new ones, and the name you add to a shared link. Each game start sends only a
rough count of the objects seen (0, 1-9, 10-19, 20-29 or 30 and more); the
list and the name stay on the device, and anyone with a link you share sees
the name in it.

Open the site with `?test=1` to stop sending events from your browser;
`?test=0` turns them back on.

## Credits

Every photo keeps its own licence, as credited here and on each reveal. The
museum objects are in the public domain. The photos are CC0, public domain,
PD-Art (faithful photos of public-domain paintings) or Creative Commons
Attribution licences (CC BY, CC BY-SA), credited to their photographers. For
the game they are resized, re-encoded and stripped of metadata; the
CC BY-SA photos stay under CC BY-SA.

<details>
<summary>Photo credits (this names the museums, so it gives away answers)</summary>

| Object | Photo | Licence | Source |
| --- | --- | --- | --- |
| A Sunday on La Grande Jatte — 1884 | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/27992) |
| Along the River During the Qingming Festival | Unknown photographer (scan via Baidu Tieba), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Along_the_River_During_the_Qingming_Festival_(detail_of_original).jpg) |
| Boulevard Montmartre, morning, cloudy weather | National Gallery of Victoria (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Camille_Pissarro_-_Boulevard_Montmartre,_morning,_cloudy_weather_-_Google_Art_Project.jpg) |
| Clay Figurine ("Dogū") with Goggle-Like Eyes | Tokyo National Museum, via ColBase (resized) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [colbase.nich.go.jp](https://colbase.nich.go.jp/collection_items/tnm/J-38392?locale=en) |
| Girl with a Pearl Earring | Mauritshuis, The Hague, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:1665_Girl_with_a_Pearl_Earring.jpg) |
| Human-headed winged lion (lamassu) (start screen and share image) | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/322609) |
| Jar with scenes of a scholar-official's life | Cleveland Museum of Art | CC0 1.0 | [clevelandart.org](https://www.clevelandart.org/art/1917.13) |
| Lady with an Ermine | National Museum in Kraków | CC0 1.0 | [zbiory.mnk.pl](https://zbiory.mnk.pl/en/catalog/157417) |
| Las Meninas | Museo del Prado (Prado in Google Earth), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Las_Meninas,_by_Diego_Vel%C3%A1zquez,_from_Prado_in_Google_Earth.jpg) |
| Mihrab (prayer niche) from the Madrasa Imami | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/449537) |
| Mochica portrait bottle of a figure in a turban | Pierre André Leclercq, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Moche_portrait_ceramic_in_Museo_Arqueol%C3%B3gico_Rafael_Larco_Herrera_(2011).jpg) |
| Portable Altar of Countess Gertrude | Cleveland Museum of Art | CC0 1.0 | [clevelandart.org](https://www.clevelandart.org/art/1931.462) |
| Portrait of a Halberdier (Francesco Guardi?) | J. Paul Getty Museum (Open Content Program) | CC0 1.0 | [getty.edu](https://www.getty.edu/art/collection/object/103QSE) |
| Red-figure chous (wine jug) | J. Paul Getty Museum | CC0 1.0 | [getty.edu](https://www.getty.edu/art/collection/object/10403M) |
| Royal Carpet with Silk and Metal Thread | Cleveland Museum of Art | CC0 1.0 | [clevelandart.org](https://clevelandart.org/art/1926.533) |
| Shiva Nataraja, Lord of the Dance | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/object/Shiva-Nataraja--95977e9e42c08b342dd8614230e2c948) |
| Statuette of a Nike | J. Paul Getty Museum (Open Content Program; photographer not named) | CC0 1.0 | [getty.edu](https://media.getty.edu/iiif/manifest/3/92503040-497c-41ed-b5ab-bb84a3d07ec3) |
| Sunflowers | The National Gallery, London (online catalogue), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Sunflowers_(1888,_National_Gallery_London).jpg) |
| The Assumption of the Virgin | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/87479/the-assumption-of-the-virgin) |
| The Birth of Venus | Gallerie degli Uffizi (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project.jpg) |
| The Code of Hammurabi | Mbzt, via Wikimedia Commons | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:P1050763_Louvre_code_Hammurabi_face_rwk-gradient.jpg) |
| The Girls on the Bridge | Nasjonalmuseet / Børre Høstland | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [nasjonalmuseet.no](https://www.nasjonalmuseet.no/en/collection/object/NG.M.00844) |
| The Golden Burial Mask of Tutankhamun | Dawid Wdowczyk, via Wikimedia Commons | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mask_of_Tutankhamun_in_2025.jpg) |
| The Kiss (Lovers) | Belvedere, Vienna (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg) |
| The Night Watch | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/SK-C-5) |
| The Standard of Ur | LeastCommonAncestor, from a photo by BabelStone (Andrew West), via Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Standard_of_Ur_-_War_side.jpg) |
| The Starry Night | Google Art Project, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg) |
| The Temple of Dendur | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/547802) |
| Tibor chocolatero (Chocolate jar) | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/10703) |
| Under the Wave off Kanagawa (The Great Wave) | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/object/RP-P-1956-733--8bd0ca806fd677ede90d092ed16e0370) |
| Wanderer above the Sea of Fog | Hamburger Kunsthalle (photo: Elke Walford), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Friedrich,_Caspar_David_-_Wanderer_%C3%BCber_dem_Nebelmeer.jpg) |

</details>

**Share image:** the link preview (`og.png`) is drawn as code at build time
from the start-screen photo. Share image photo: The Metropolitan Museum of
Art, CC0 1.0 — Human-headed winged lion (lamassu),
<https://www.metmuseum.org/art/collection/search/322609>. Its map, like the
start-screen mini map, uses Natural Earth 1:110m countries (public domain),
simplified for display.

**Map:** map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, vector tiles by [OpenFreeMap](https://openfreemap.org/) in the
[OpenMapTiles](https://openmaptiles.org/) schema. The fallback map, reveal
country tints, start-screen mini map and place names come from
[Natural Earth](https://www.naturalearthdata.com/) (public domain).

**Fonts:** Bricolage Grotesque (© 2022 The Bricolage Grotesque Project
Authors) and Instrument Sans (© 2022 The Instrument Sans Project Authors), in
the game and its share image, under the SIL Open Font License 1.1,
self-hosted from the Fontsource packages.

**Name filter:** a name in a challenge link is checked against the [List of
Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
(its contributors, CC BY 4.0), so a crafted link cannot show an offensive name.

**Code libraries:** MapLibre GL JS (BSD-3-Clause), PhotoSwipe (MIT),
posthog-js (Apache-2.0 AND MIT). Their full licence texts, and the fonts'
OFL, ship with the site as `licenses.txt` (generated at build time from the
runtime dependencies).

## Licence

The code has no open-source licence for now: all rights reserved. Every image
keeps its own licence, as credited above.

## Run it locally

Needs Node 24 (see `.nvmrc`).

```sh
npm ci            # installs dependencies and the git hooks
npm run dev       # prints the local URL (the game runs at the root path)
```

| Command | What it does |
| --- | --- |
| `npm test` | type check, generated-file checks, the item check, unit and design tests (no browser, offline) |
| `npm run lint` | ESLint and Stylelint (no raw colours outside the tokens) |
| `npm run build` | production build into `dist/` |
| `npm run check:build` | checks the built site (move `dist/**/*.map` out first, as CI does) |
| `npm ci --prefix worker` | installs the Worker tooling (wrangler) apart from the game; `npm run verify` does it when needed |
| `npx playwright install chromium` | one-time browser download for the E2E tests |
| `npm run test:e2e` | builds the deploy profile, serves it over HTTPS on 127.0.0.1:4443 (`E2E_PORT` overrides) and runs the browser tests on five viewports |
| `npm run items:check` | validates `data/` and `images/` against the evidence rules |

How content is chosen and checked: [docs/content.md](docs/content.md). Screen
layout, states and copy keys: [docs/screen-spec.md](docs/screen-spec.md).
Visual system: [DESIGN.md](DESIGN.md).

## Debugging

- The console prints one analytics line at start: `analytics: on`,
  `analytics: off (<reason>)` or `analytics: console` in development.
- `?test=1` shows a test badge; tap it to see the events that would have been
  sent and the queue counts.
- The error screen shows a reference line with the error name and the build
  id; `<meta name="build-id">` in the page and `build.txt` hold the same id.
- Live errors by build: [docs/ops.md](docs/ops.md#runbook-errors-after-a-deploy).

## Maintenance

- **Node:** `engines` is `>=24 <25`; change `.nvmrc` and `engines` together.
- **Dependencies** are pinned to exact versions. To update one:
  `npm install <name>@<version>` (this updates `package-lock.json`), then
  `npm test`, `npm run lint` and `npm run test:e2e`. A posthog-js update must
  also pass the analytics unit tests and the E2E analytics tests (they decode
  the real requests); a MapLibre update must pass the map and fallback-map E2E
  tests. Commit the lockfile with the change.
- **Deploy and roll back** from the founder's machine only, with
  `npm run deploy` and `npm run rollback`
  ([docs/ops.md](docs/ops.md#deploy-and-rollback)); CI only verifies. Fix
  forward on `main` after a rollback.
