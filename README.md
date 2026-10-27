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
   Anything older is the leftmost stop, "4000 BCE or earlier".
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

The year control's leftmost stop, "4000 BCE or earlier", scores full marks
when the object's whole date range ends before 4000 BCE; for any younger
object it counts as a guess of 4000 BCE.

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
`result_shared`, `challenge_opened`, `challenge_completed`, `tour_ended` and
`week_active`. Each carries game facts (round, step, points, time left, the
channel tag from the link you followed, a random reference that lasts one
game) and the build id, plus the technical details
PostHog's library adds to every event: browser and version, operating system,
device type, screen and window size, language, time zone, the browser's
user-agent string and the site that linked here. Page addresses are sent
without their query string, except campaign tags (`utm_*` and `ref`). The full
list is in [docs/analytics.md](docs/analytics.md#events).

Your device remembers which objects you have seen, so your next game shows
new ones, and the name you add to a shared link. Each game start sends only a
rough count of the objects seen (0, 1-9, 10-19, 20-29 or 30 and more); the
list and the name stay on the device, and anyone with a link you share sees
the name in it. It also keeps the last week in which it finished a game, so
the first finished game of a week can say whether you also played the week
before (`week_active`).

### The weekly board

Finished games go on this week's board automatically under a generated name.
The board shows a generated three-word name, the score and the date: the name
comes from a random key this browser creates for the board, so it stays the
same for this device across weeks while the browser keeps site data. Nobody
types a name. The key is sent only to this site's own API (as a request
header, never in an address) and never to analytics; the server stores a hash
of it, one best score per device and week, and never the answer pins, your IP
address or your browser's user-agent string. The game only adds a random or
challenge game you finished this week; replays, challenges of objects you had
all seen before and test games are not ranked. Switch "Add my games to the
board" off under "Your board scores" to stop future games going on the board;
the same place lists your weekly bests and removes them (removing this week's
score also stops another one from this browser until the board resets on
Monday). Two more events come with the board: `board_submitted` (the outcome
of an automatic entry) and `board_viewed` (you opened the board).

Open the site with `?test=1` to stop sending events from your browser for 24
hours; `?test=0` turns them back on sooner.

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
| 1903 Wright Flyer | National Air and Space Museum, Smithsonian Institution | CC0 1.0 | [airandspace.si.edu](https://airandspace.si.edu/collection-objects/1903-wright-flyer/nasm_A19610048000) |
| A Sunday on La Grande Jatte — 1884 | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/27992) |
| Along the River During the Qingming Festival | Unknown photographer (scan via Baidu Tieba), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Along_the_River_During_the_Qingming_Festival_(detail_of_original).jpg) |
| Ambassador Cornelis Calkoen at his Audience with Sultan Ahmed III | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/SK-A-4078) |
| Apollo Belvedere | Fabrizio Garrisi, via Wikimedia Commons | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Apollo_del_Belvedere,_dopo_il_restauro_del_2020-2024._Musei_Vaticani,_Museo_Pio_Clementino_-FG3.jpg) |
| Apollo and Daphne | Architas, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Apollo_and_Daphne_(Bernini)_(cropped).jpg) |
| Barberini Ivory (The Triumphant Emperor) | Shonagon, via Wikimedia Commons | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Ivoire_Barberini_-_Mus%C3%A9e_du_Louvre_Objets_d%27art_OA_9063_;_MND_211.jpg) |
| Boulevard Montmartre, morning, cloudy weather | National Gallery of Victoria (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Camille_Pissarro_-_Boulevard_Montmartre,_morning,_cloudy_weather_-_Google_Art_Project.jpg) |
| Bronze Sun Disc (Ceremonial Standard) from Alacahöyük | Klaus-Peter Simon, via Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:AlacaStandarte.jpg) |
| Bust of Queen Nefertiti | Philip Pikart, via Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nofretete_Neues_Museum.jpg) |
| Clay Figurine ("Dogū") with Goggle-Like Eyes | Tokyo National Museum, via ColBase (resized) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [colbase.nich.go.jp](https://colbase.nich.go.jp/collection_items/tnm/J-38392?locale=en) |
| Dancing Girl | Gary Todd, via Wikimedia Commons | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Dancing_girl_of_Mohenjo-daro.jpg) |
| David | Jörg Bittner Unna, via Wikimedia Commons | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:%27David%27_by_Michelangelo_Fir_JBU004.jpg) |
| George Washington (Lansdowne Portrait) | National Portrait Gallery, Smithsonian Institution | CC0 1.0 | [npg.si.edu](https://npg.si.edu/object/npg_NPG.2001.13) |
| Ginevra de' Benci | National Gallery of Art, Washington | CC0 1.0 | [nga.gov](https://www.nga.gov/artworks/50724-ginevra-de-benci-obverse) |
| Girl with a Pearl Earring | Mauritshuis, The Hague, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:1665_Girl_with_a_Pearl_Earring.jpg) |
| Gold funerary mask (the "Mask of Agamemnon") | Jebulon, via Wikimedia Commons | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Agamemnon_mask_NAMA_Athens_Greece.jpg) |
| Human-headed winged lion (lamassu) (start screen and share image) | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/322609) |
| Impression, Sunrise | Unknown photographer (art database scan), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Monet_-_Impression,_Sunrise.jpg) |
| Irises | J. Paul Getty Museum (Open Content Program) | CC0 1.0 | [getty.edu](https://www.getty.edu/art/collection/object/103JNH) |
| Jar with scenes of a scholar-official's life | Cleveland Museum of Art | CC0 1.0 | [clevelandart.org](https://www.clevelandart.org/art/1917.13) |
| Lady with an Ermine | National Museum in Kraków | CC0 1.0 | [zbiory.mnk.pl](https://zbiory.mnk.pl/en/catalog/157417) |
| Las Meninas | Museo del Prado (Prado in Google Earth), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Las_Meninas,_by_Diego_Vel%C3%A1zquez,_from_Prado_in_Google_Earth.jpg) |
| Liberty Leading the People (28 July 1830) | Photo: Shonagon (2024, after restoration), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:La_Libert%C3%A9_guidant_le_peuple_-_Eug%C3%A8ne_Delacroix_-_Mus%C3%A9e_du_Louvre_Peintures_RF_129_-_apr%C3%A8s_restauration_2024.jpg) |
| Mihrab (prayer niche) from the Madrasa Imami | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/449537) |
| Mochica portrait bottle of a figure in a turban | Pierre André Leclercq, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Moche_portrait_ceramic_in_Museo_Arqueol%C3%B3gico_Rafael_Larco_Herrera_(2011).jpg) |
| Muisca Raft (Balsa Muisca) | Pedro Szekely, via Wikimedia Commons | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gold_Museum,_Bogota_(36145671394).jpg) |
| Narmer Palette | Archivio fotografico Museo Egizio, Turin (early 20th-century postcard), via Wikimedia Commons | CC0 1.0 | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Cairo,_Egyptian_Museum,_Antiquities,_photo_17_of_97_-_Archivio_fotografico_Museo_Egizio,_Turin_Album3_016.jpg) |
| Paris Street; Rainy Day | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/20684) |
| Pergamon Altar: Athena group from the east frieze | Ealdgyth, via Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pergamonaltarathena.jpg) |
| Piri Reis World Map (fragment) | Topkapı Palace Museum Library scan, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Piri_reis_world_map_01.jpg) |
| Portable Altar of Countess Gertrude | Cleveland Museum of Art | CC0 1.0 | [clevelandart.org](https://www.clevelandart.org/art/1931.462) |
| Portrait of a Halberdier (Francesco Guardi?) | J. Paul Getty Museum (Open Content Program) | CC0 1.0 | [getty.edu](https://www.getty.edu/art/collection/object/103QSE) |
| Primavera | Gallerie degli Uffizi (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_Primavera_-_Google_Art_Project.jpg) |
| Red-figure chous (wine jug) | J. Paul Getty Museum | CC0 1.0 | [getty.edu](https://www.getty.edu/art/collection/object/10403M) |
| Return of the Prodigal Son | State Hermitage Museum (high-resolution release), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Rembrandt_Harmensz._van_Rijn_-_The_Return_of_the_Prodigal_Son.jpg) |
| Royal Carpet with Silk and Metal Thread | Cleveland Museum of Art | CC0 1.0 | [clevelandart.org](https://clevelandart.org/art/1926.533) |
| Seated Scribe | Isabella Stewart Gardner Museum, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gentile_Bellini_009.jpg) |
| Self-Portrait with Fur-Trimmed Robe | Bayerische Staatsgemäldesammlungen – Alte Pinakothek, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:D%C3%BCrer_Alte_Pinakothek.jpg) |
| Shiva Nataraja, Lord of the Dance | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/object/Shiva-Nataraja--95977e9e42c08b342dd8614230e2c948) |
| Statuette of a Nike | J. Paul Getty Museum (Open Content Program; photographer not named) | CC0 1.0 | [getty.edu](https://media.getty.edu/iiif/manifest/3/92503040-497c-41ed-b5ab-bb84a3d07ec3) |
| Sun Stone (Piedra del Sol) | Arian Zwegers, via Wikimedia Commons | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mexico_City,_Museo_Nacional_de_Antropologia,_Stone_of_the_Sun_(20693400581).jpg) |
| Sunflowers | The National Gallery, London (online catalogue), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Sunflowers_(1888,_National_Gallery_London).jpg) |
| Terrace of a Café at Night (Place du Forum) | Kröller-Müller Museum, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Terrace_of_a_Caf%C3%A9_at_Night_(Place_du_Forum)_1888.jpg) |
| The Alexander Sarcophagus | Francesco Bini (Sailko), via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Artisti_greci_attivi_in_fenicia,_sarcofago_di_abdalonymo,_detto_di_alessandro,_da_sidone,_312-307_ac_ca._01.jpg) |
| The Assumption of the Virgin | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/87479/the-assumption-of-the-virgin) |
| The Birth of Venus | Gallerie degli Uffizi (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project.jpg) |
| The Code of Hammurabi | Mbzt, via Wikimedia Commons | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:P1050763_Louvre_code_Hammurabi_face_rwk-gradient.jpg) |
| The Creation of Adam | Unknown photographer, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Creaci%C3%B3n_de_Ad%C3%A1n.jpg) |
| The Girls on the Bridge | Nasjonalmuseet / Børre Høstland | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [nasjonalmuseet.no](https://www.nasjonalmuseet.no/en/collection/object/NG.M.00844) |
| The Golden Burial Mask of Tutankhamun | Dawid Wdowczyk, via Wikimedia Commons | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mask_of_Tutankhamun_in_2025.jpg) |
| The Hay Wain | The National Gallery, London (via gallerix.ru), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:John_Constable_-_The_Hay_Wain_(1821).jpg) |
| The Kadesh Treaty (clay tablet) | Osama Shukir Muhammed Amin FRCP(Glasg), via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kadesh_Treaty,_written_in_Akkadian._1269_BCE._From_Bo%C4%9Fazk%C3%B6y,_Turkey._Clay_tablet._Museum_of_the_Ancient_Orient,_Istanbul,_Turkey.jpg) |
| The Kiss (Lovers) | Belvedere, Vienna (Google Art Project), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg) |
| The Liberty Bell | Gage Skidmore, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Liberty_Bell_(55259781330).jpg) |
| The Night Watch | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/SK-C-5) |
| The Ottoman Army Arrives at Szigetvár (History of Sultan Süleyman) | Chester Beatty (viewer.cbl.ie scan), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:The_Ottoman_army_arrives_at_Szigetvar,_from_the_History_of_Sultan_S%C3%BCleyman_(Chester_Beatty,_T._413).jpg) |
| The Rosetta Stone | Hans Hillewaert, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Rosetta_Stone.JPG) |
| The Standard of Ur | LeastCommonAncestor, from a photo by BabelStone (Andrew West), via Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Standard_of_Ur_-_War_side.jpg) |
| The Starry Night | Google Art Project, via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg) |
| The Temple of Dendur | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/547802) |
| The warship Vasa | Je-str, via Wikimedia Commons | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Wasa,_Seitenansicht.jpg) |
| Tibor chocolatero (Chocolate jar) | Art Institute of Chicago | CC0 1.0 | [artic.edu](https://www.artic.edu/artworks/10703) |
| Tipu's Tiger | Laika ac (Flickr), via Wikimedia Commons | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:V%26A_Museum_(19180586961).jpg) |
| Tughra (Insignia) of Sultan Süleiman the Magnificent (r. 1520–66) | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/449533) |
| Under the Wave off Kanagawa (The Great Wave) | Rijksmuseum | Public domain | [rijksmuseum.nl](https://www.rijksmuseum.nl/en/collection/object/RP-P-1956-733--8bd0ca806fd677ede90d092ed16e0370) |
| Urfa Man (the Balıklıgöl Statue) | Cobija, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Urfa_Adam%C4%B1.jpg) |
| Venus of Willendorf | Bjørn Christian Tørrissen, via Wikimedia Commons | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Venus_of_Willendorf_-_All_sides.jpg) |
| Wanderer above the Sea of Fog | Hamburger Kunsthalle (photo: Elke Walford), via Wikimedia Commons | PD-Art | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Friedrich,_Caspar_David_-_Wanderer_%C3%BCber_dem_Nebelmeer.jpg) |
| Washington Crossing the Delaware | The Metropolitan Museum of Art | CC0 1.0 | [metmuseum.org](https://www.metmuseum.org/art/collection/search/11417) |
| Weary Herakles (Herakles Farnese type) from Perge | Carole Raddato, via Wikimedia Commons | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Statue_of_Hercules_from_Perge,_reproduced_in_the_late_2nd_century_AD_from_the_4th_century_BC_original_by_Lysippos,_Antalya_Museum,_Turkey.jpg) |

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
| `npm run test:e2e` | builds the deploy profile and the board-test profile (`dist-board/`), serves them over HTTPS on 127.0.0.1:4443 and the next port (`E2E_PORT` overrides) and runs the browser tests on five viewports |
| `npm run items:check` | validates `data/` and `images/` against the evidence rules |
| `npm run dev:board` | the weekly board locally: a seeded local Worker in dark mode plus the dev server with the board on (`npm ci --prefix worker` once); open `/?fixture=end-random` for a finished test game ([docs/ops.md](docs/ops.md#local-board-loop)) |

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
