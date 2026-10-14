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
        onSettingsChange(() => applyMapSettings(map));
        applyMapSettings(map);
    });
});

// Map styling that follows the accessibility settings: high contrast thickens paths and routes and darkens
// labels; larger text enlarges building labels. Layers added later (labels load asynchronously) call this too.
function applyMapSettings(map) {
    const strong = highContrast();
    const set = (layer, prop, value) => { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); };
    set('accessiblepaths-ext', 'line-width', strong ? 4 : 2);
    set('accessiblepaths-int', 'line-width', strong ? 4 : 2);
    set('paths', 'line-width', strong ? 5 : 3);
    set('buildings', 'fill-opacity', strong ? 0.55 : 0.3);
    set('route-outdoor', 'line-width', strong ? 9 : 6);
    set('route-indoor', 'line-width', strong ? 9 : 6);
    set('route-stairs', 'line-width', strong ? 10 : 7);
    set('building-labels', 'text-color', strong ? '#000000' : '#1b1b1b');
    set('building-labels', 'text-halo-width', strong ? 3 : 1.6);
    if (map.getLayer('building-labels')) {
        const k = settings.largerText ? 1.35 : 1;
        map.setLayoutProperty('building-labels', 'text-size', ['interpolate', ['linear'], ['zoom'], 16, 11 * k, 19, 15 * k]);
    }
}
