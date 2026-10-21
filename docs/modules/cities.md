# Cities through history (cities)

Cities appear, grow, change style and vanish with the clock, from Jericho (8000 BC), Çatalhöyük and Uruk
to today's megacities. From orbit, the largest cities of the date are labelled with approximate
populations. On the ground, the life module draws their era-styled buildings, monuments and people.
Everything is approximate (validity `cities.population`). Cross-module API: `src/modules/cities/public.ts`.

One start date: `TOWNS_FROM_YEAR` (`public.ts`, astronomical year -7999, Jericho's founding) is the earliest
town in the table. Labels and the validity range (`jdMin`, hidden before) begin there, the ground queries
return nothing earlier, and the life module keys its towns on it.

## Data (`tools/build-cities.mjs` → `public/data/cities/cities.json`)

- **History table** (`src/modules/cities/history.json`): hand-entered, with sources per row (Chandler
  1987, Modelski 2003, Morris 2010, Bairoch 1988, UN World Urbanization Prospects 2018). Each city has:
  - Its founding and (where it ended) abandonment years.
  - Population estimates over time.
  - Its architectural style by period (e.g. Rome: classical, then medieval, industrial, modern).
  - Optional names by period (Byzantium, Constantinople, Istanbul).
- **Natural Earth populated places** (v5.1.2, public domain): today's cities of at least 300 000 people
  that the table does not hold. A place is left out when a table city still standing in 1950, or a larger
  Natural Earth place, lies within about 0.35° (twin cities such as Rawalpindi and Islamabad keep one
  label); ruins nearby do not count, so Zibo (by Linzi), St. Louis (by Cahokia) and Mosul (by Nineveh)
  are there. They appear from 1950 at a third of today's size (approximate).
- **Monuments** (`monuments.json`): drawn at their real places from completion until destruction or
  ruin (`end`, excluded). A building that changed use has one row per use: Hagia Sophia is a domed
  church (the `baroqueChurch` model stands in for a Byzantine one) from 537 and a mosque with minarets
  from 1453. Examples: the Giza pyramids, the ziggurats of Ur and Babylon (Etemenanki), the Parthenon,
  the Temple of Jupiter, Hagia Sophia, the Pyramid of the Sun, El Castillo, the Templo Mayor, Angkor Wat,
  the Great Mosque of Djenné, Notre-Dame, the Forbidden City, Himeji Castle and the Empire State Building.

Years in the table are historical (negative = BC, no year 0). `cities.json` uses astronomical numbering
(1 BC = 0). `data.ts` turns a JD into a year (`yearOfJd`). Population is log-linear between estimates and
ramps up from 1000 people at founding. The built-up radius comes from a density of 25 000 people per
km² before 1800, 12 000 until 1950 and 5 000 for modern metro areas.

The table first planned was Reba, Reitsma & Seto (2016) on Harvard Dataverse (CC BY 4.0). Its download
sits behind a personal-details guestbook, so the table is hand-entered from the same underlying sources
instead.

## Labels

Label source `cities` (`index.ts` `cityLabels`): the largest cities of the date above the camera's
horizon, more as the camera nears Earth (12 beyond 20 000 km, then 30, 60 and 120). A label stands 50 m
above the ellipsoid. Before the count is cut, cities outside the camera's horizon cap are skipped (angle
from the nadir above acos(g/d) + acos(g/(g + 50 m)), g the ground radius under the camera, terrain
included through `view.nearestSurface()`). So 300 km above Naples the 120 labels are the largest cities
within about 1900 km (Istanbul, Paris and London down to Naples), not the far side's megacities, and at
street level only towns within about 30 km are named, on a high plateau too (from Tenochtitlan the
ellipsoid's horizon would reach Cholula, 97 km away).
The text is "Rome ≈450k". The overlay declutters by priority (log of the population). Terrain and
buildings do not hide labels.

## Ground level (drawn by the life module)

`citiesAtJd` (the towns of the date) and `monumentsNear` feed `life/population.ts` `buildingsAround`
(ranges in `docs/modules/life.md`):

- Building kinds: `life/kit/buildings.ts`, procedural low-poly in 17 styles.
- Placement:
  - Houses go in 22 m cells on blocks between streets (every fifth row and column). They are denser
    near the centre and slightly jittered and twisted in unplanned towns.
  - The style's landmarks stand at the centre (ziggurat, temple, cathedral and keep, mosque, pagoda,
    step pyramid, mud mosque, baroque church, towers).
  - A monument standing in town replaces the style landmark of its kind (Etemenanki is Babylon's
    ziggurat; New York keeps two of its three towers beside the Empire State Building). A style
    landmark that would overlap a monument of another kind is left out.
  - Monuments keep their footprint plus a 6 m lane clear of houses.
  - Walled styles (Mesopotamian, Indus, Chinese, classical, Persian, medieval European, Islamic,
    Japanese) get a wall ring before 1800, in towns of more than 3000 people, with a gate on each of
    the four main streets.
  - Modern cities have towers at the centre, apartments, then suburbs.
- Townspeople fill the streets, dressed by the town's style period rather than by the year: modern
  clothes in `industrial` and `modern` towns (Manchester from 1780), tunics and robes in every other
  style (Baghdad or Jerusalem until their `modern` period in 1950). The farmland around towns holds
  livestock where it lived then, and no wild herds or wild plants inside towns.

## Bookmarks (`sites.json`)

| Id                       | View                                                   |
| ------------------------ | ------------------------------------------------------ |
| `city-giza-2450bc`       | The three pyramids from the plateau to the south-east  |
| `city-babylon-570bc`     | Etemenanki in Nebuchadnezzar's Babylon                 |
| `city-rome-117ad`        | Up a street to the Temple of Jupiter on the Capitoline |
| `city-tenochtitlan-1500` | The Templo Mayor of the Aztec capital                  |
| `city-paris-1350`        | Notre-Dame across the Seine                            |
| `city-newyork-1935`      | Midtown towards the Empire State Building              |
| `city-labels-117ad`      | The Mediterranean world from 3500 km with city labels  |

## Tests

- **Unit** (`tests/unit/cities`):
  - Table sanity, interpolation, founding and abandonment, styles by period, largest cities by date.
  - One start date: `TOWNS_FROM_YEAR` is the table's earliest founding, the validity's `jdMin` and the
    label cut-off.
  - Natural Earth merge: cities by ruins (Zibo, St. Louis, Mosul) are in the table.
  - Labels: 50 m above the ellipsoid, nothing beyond the horizon at street level (also on the Valley of
    Mexico's plateau), the top n within the horizon cap from orbit.
  - Years and radii.
  - Monuments and sites: Hagia Sophia a church before 1453 and a mosque after.
  - Building placement: landmarks, blocks, walls only before 1800 (a walled style in 1900 has none);
    townsfolk instead of wild animals.
- **E2E** (`tests/e2e/cities.spec.ts`):
  - Giza with three pyramids.
  - Rome with temples, houses and people, and the Temple of Jupiter in view (pale marble probe).
  - New York with towers.
  - Labels at AD 117 (Rome and Alexandria, no Constantinople or Tenochtitlan).

## Known gaps

- City footprints are circles around one centre; there are no rivers, harbours or real street plans, and
  no districts or suburbs of different ages.
- Natural Earth cities without history appear only from 1950.
- There is no Byzantine church model: Hagia Sophia before 1453 uses the baroque church.
- Pre-industrial cities have no night lights; the earth module's city lights start at about 1880.
- A city's style changes all at once at a period boundary.
