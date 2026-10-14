# AccessBC data

The original ArcGIS shapefiles for this project were not preserved. Every layer except
`reststop.geojson` was rebuilt on 2026-10-14 from the Mapbox tilesets the app was serving
(account `bcdsg-lec`), using [scripts/extract-mapbox-tilesets.js](../../scripts/extract-mapbox-tilesets.js).
Each tile was fetched at the tileset's maximum zoom, clipped to its exact bounds, and the
pieces were stitched back into whole features. Coordinates are WGS84 (EPSG:4326), rounded to 7 decimals.

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

## Known quirks

- Field names were cut to 10 characters by the shapefile export (`Descriptio`, `Food_dinin`,
  `Seating_gr`, `Seating_in`, `Single_res`). The app's code uses these shortened names.
- `accessiblepaths.SHAPE_Leng` is stale. It predates later edits to the lines, so use `Shape_Le_1`.
- `accessiblepaths.Type` is `Exterior` or `Interior`. Interior segments are routes through buildings.
- `paths` comes from OpenStreetMap. `highway` holds the OSM tag (`footway`, `path`, `steps`, ...).
- 38 entrances and 8 elevators have no `Building` name.
- Every entrance and elevator has `Status: Working`.
- `buildings.Food_dinin` is `Yes` for only one building.
