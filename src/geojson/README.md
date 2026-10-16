# AccessBC data

The original ArcGIS shapefiles for this project were not preserved. Every layer except
`reststop.geojson` was rebuilt on 2026-10-14 from the Mapbox tilesets the app was serving
(account `bcdsg-lec`), using [scripts/extract-mapbox-tilesets.js](../../scripts/extract-mapbox-tilesets.js).
Each tile was fetched at the tileset's maximum zoom, clipped to its exact bounds, and the
pieces were stitched back into whole features. Coordinates are WGS84 (EPSG:4326), rounded to 7 decimals.

The app now loads these files directly. They are the source of truth, and the Mapbox tilesets are no longer used.
See [updatingdata.md](../../updatingdata.md) for how to edit them.

| File | Mapbox tileset | Max zoom | Features | Geometry |
|---|---|---|---|---|
| `accessiblepaths.geojson` | `bcdsg-lec.ctxmzxxp` | 16 | 280 | LineString |
| `paths.geojson` | `bcdsg-lec.6wha4sxm` | 16 | 455 | LineString |
| `buildings.geojson` | `bcdsg-lec.acj06c4q` | 16 | 298 | Polygon |
| `entrances.geojson` | `bcdsg-lec.cf8ep7jl` | 16 | 183 | Point |
| `elevators.geojson` | `bcdsg-lec.9zp1t3fm` | 15 | 71 | Point |
| `curbcuts.geojson` | `bcdsg-lec.1bsbmi40` | 16 | 411 | Point |
| `shuttlestops.geojson` | `bcdsg-lec.b0eg11k3` | 14 | 9 | Point |
| `bluelights.geojson` | `bcdsg-lec.438a3ike` | 14 | 44 | Point |
| `bikeracks.geojson` | `bcdsg-lec.35wuf8yc` | 16 | 24 | Point |

## Accuracy

Tile coordinates are quantized to roughly 0.1 m at zoom 16 and 0.4 m at zoom 14. The
rebuilt geometry was checked against the measurements ArcGIS stored on each feature:

- `buildings`: every area is within 1% of `Shape_Area` (sq ft).
- `paths`: every length is within 1.3% of `Shape_Length` (degrees).
- `accessiblepaths`: every length is within 3% of `Shape_Le_1` (ft).

## Building heights

`buildings.height_m` is each building's height in metres above the surrounding ground, measured from the
USGS 3DEP lidar survey *MA_CentralEastern_1_2021* (public domain) by
[scripts/lidar/derive-building-heights.py](../../scripts/lidar/derive-building-heights.py): the median elevation
of lidar points classified as building inside the footprint, minus the median of ground points 3–15 m outside it.
It's the main roof height, so towers and spires aren't included. 258 of 298 buildings have one; the other 40 are
small garages and sheds with too few lidar points, so they're `null` (the 3D view shows them at 3 m). Re-run
the script after adding or reshaping buildings.

## City sidewalks (`sidewalks.geojson`)

City sidewalks, street crossings and footways around the campuses, from OpenStreetMap, built by
[scripts/osm-sidewalks.mjs](../../scripts/osm-sidewalks.mjs). Routes use them only when BC's own paths can't make
the trip: between campuses, or from off campus. The app loads the file only then.

**Licence:** © OpenStreetMap contributors, under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
Unlike the rest of this folder, this file must stay under the ODbL, and anything derived from it must be shared
under the ODbL too. The map credits OpenStreetMap.

Each feature is one OpenStreetMap way. `Type` is `Sidewalk`, `Crossing`, `Street` (a road tagged as having a
sidewalk that isn't drawn separately), or `Stairs`. Crossings carry `crossing` (the kind of crosswalk) and `kerb`
(the worst curb at either end: `lowered`, `flush`, `raised`, or `unknown`). `rough`, `campus`, and `level` mark
unpaved ways, ways inside a BC campus boundary, and bridges and tunnels. None of it has been checked for
accessibility, and the app says so on every route that uses it. Many curb ramps aren't tagged in OpenStreetMap
yet; adding them there (`kerb=lowered` on the crossing's end nodes) improves the routes after the next refresh.

## Known quirks

- Field names were cut to 10 characters by the shapefile export (`Descriptio`, `Food_dinin`,
  `Seating_gr`, `Seating_in`, `Single_res`). The app's code uses these shortened names.
- `accessiblepaths.SHAPE_Leng` is stale. It predates later edits to the lines, so use `Shape_Le_1`.
- `accessiblepaths.Type` is `Exterior` or `Interior`. Interior segments are routes through buildings.
- `paths` comes from OpenStreetMap. `highway` holds the OSM tag (`footway`, `path`, `steps`, ...).
- 38 entrances and 8 elevators have no `Building` name.
- Every entrance and elevator has `Status: Working`.
- `buildings.Food_dinin` is `Yes` for only one building.
