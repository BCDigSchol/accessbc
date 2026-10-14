// Area covered by the self-hosted basemap (see scripts/build-basemap.sh)
const BASEMAP_BOUNDS = [[-71.215, 42.305], [-71.135, 42.360]];

// Builds the basemap style from the self-hosted tiles, fonts, and sprites in src/basemap
function basemapStyle() {
    const base = new URL('src/basemap/', document.baseURI).href;
    return {
        version: 8,
        glyphs: base + 'fonts/{fontstack}/{range}.pbf',
        sprite: base + 'sprites/' + BASEMAP_FLAVOR,
        sources: {
            protomaps: {
                type: 'vector',
                url: 'pmtiles://' + base + 'basemap.pmtiles',
                attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
            }
        },
        layers: BASEMAP_LAYERS
    };
}

//Sets up initialmap with all map functions called on load
document.addEventListener('DOMContentLoaded', function () {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
        container: 'map',
        style: basemapStyle(),
        zoom: 15,
        minZoom: 12,
        maxBounds: BASEMAP_BOUNDS,
        center: [-71.170820, 42.336190]
    });
    window.map = map;

    map.on('load', () => {
        addMapControls(map);
        createLegend('legend', legendData, map);
        createElevationLegend('legend');
        addMapData(map);
        addPopupHandlers(map);
        addBuildingHandler(map);
        setupElevationHandler(map);
        setupDirections(map);
    });
});
