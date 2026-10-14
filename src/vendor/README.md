# Vendored libraries

These are committed so the site has no runtime dependency on any CDN. To upgrade one,
replace its files with the same files from the newer npm package.

| Library | Version | Files | License |
|---|---|---|---|
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | 5.24.0 | `dist/maplibre-gl.js`, `dist/maplibre-gl.css` | BSD-3-Clause ([LICENSE.txt](maplibre-gl/LICENSE.txt)) |
| [PMTiles](https://github.com/protomaps/PMTiles) | 4.5.0 | `dist/pmtiles.js` | BSD-3-Clause |

The basemap in `src/basemap/` is built by [scripts/build-basemap.sh](../../scripts/build-basemap.sh) from:

- Basemap tiles: [Protomaps](https://protomaps.com) daily build, OpenStreetMap data © OpenStreetMap contributors (ODbL)
- Style layers: [@protomaps/basemaps](https://github.com/protomaps/basemaps) 5.7.2 (BSD-3-Clause), `white` and `dark` flavors (dark mode). `scripts/build-basemap.sh --style-only` regenerates just the styles, fonts, and sprites
- Fonts and sprites: [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) (Noto Sans, OFL)
- Terrain: [Terrain Tiles on AWS Open Data](https://registry.opendata.aws/terrain-tiles/), Terrarium encoding (mostly USGS 3DEP in this area)
