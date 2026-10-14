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

## Basemap and terrain

The basemap (streets, labels, water) and the terrain used by the elevation tool are in
[src/basemap/](src/basemap/), cut from OpenStreetMap to the area around the campuses. To refresh them with
newer OpenStreetMap data, run [scripts/build-basemap.sh](scripts/build-basemap.sh) (requirements are listed
at the top of the script), then preview and commit.
