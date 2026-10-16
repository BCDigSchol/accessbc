# Updating map data

All map data lives in this repository; there is no Mapbox account or upload step.

## Campus layers (paths, buildings, entrances, etc.)

The layers are GeoJSON files in [src/geojson/](src/geojson/), one feature per line. See
[src/geojson/README.md](src/geojson/README.md) for what each file contains and the meaning of its fields.

1. Open the file in [QGIS](https://qgis.org) (or [geojson.io](https://geojson.io) for small edits).
2. Edit features and attributes. Keep the existing field names. The app reads them by name, and some are
   shortened to 10 characters (e.g. `Descriptio`, `Single_res`).
3. Save as GeoJSON in WGS84 (EPSG:4326), keeping the same file name.
4. Preview locally with `python3 scripts/serve.py` and open http://localhost:8000.
5. Commit and push. GitHub Pages publishes the change.

## City sidewalks

[src/geojson/sidewalks.geojson](src/geojson/sidewalks.geojson) comes from OpenStreetMap. To refresh it with newer
data, run `node scripts/osm-sidewalks.mjs` (Node 18 or later, no packages needed; it downloads about 10 MB from the
public Overpass API, and retries if the servers are busy). See [src/geojson/README.md](src/geojson/README.md) for
the fields and the licence.

## BC shuttles

[src/geojson/shuttles.json](src/geojson/shuttles.json) is a snapshot of BC's shuttle routes. Each semester, or when
routes change, check the schedules in [scripts/shuttles.mjs](scripts/shuttles.mjs) (`SERVICE`) against
[BC's shuttle page](https://www.bc.edu/bc-web/offices/aux-services/sites/transportation-parking/shuttles.html), then
run `node scripts/shuttles.mjs`.

## Basemap and terrain

The basemap (streets, labels, water) and the terrain used by the elevation tool are in
[src/basemap/](src/basemap/), cut from OpenStreetMap to the area around the campuses. To refresh them with
newer OpenStreetMap data, run [scripts/build-basemap.sh](scripts/build-basemap.sh) (requirements are listed
at the top of the script), then preview and commit.
