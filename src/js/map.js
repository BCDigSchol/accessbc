// Area covered by the self-hosted basemap (see scripts/build-basemap.sh)
const BASEMAP_BOUNDS = [[-71.215, 42.305], [-71.135, 42.360]];

// The basemap flavor in use: white, or dark in dark mode (see scripts/build-basemap.sh)
let basemapFlavor = darkMode() ? 'dark' : 'white';

// Builds the basemap style from the self-hosted tiles, fonts, and sprites in src/basemap
function basemapStyle() {
    const base = new URL('src/basemap/', document.baseURI).href;
    return {
        version: 8,
        glyphs: base + 'fonts/{fontstack}/{range}.pbf',
        sprite: base + 'sprites/' + basemapFlavor,
        sources: {
            protomaps: {
                type: 'vector',
                url: 'pmtiles://' + base + 'basemap.pmtiles',
                attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
            }
        },
        layers: BASEMAP_STYLES[basemapFlavor]
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
        center: [-71.170820, 42.336190],
        // The map is visual only; screen reader users get the same information as text
        locale: { 'Map.Title': 'Campus map. Search and Directions give the same information as text.' }
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

// Switch the basemap between its white and dark flavors: the same layers with different paint.
function setBasemapFlavor(map, flavor) {
    if (flavor === basemapFlavor) return;
    const from = BASEMAP_STYLES[basemapFlavor], to = BASEMAP_STYLES[flavor];
    to.forEach((layer, i) => {
        if (!map.getLayer(layer.id)) return;
        const keys = new Set([...Object.keys(layer.paint || {}), ...Object.keys(from[i].paint || {})]);
        for (const key of keys) map.setPaintProperty(layer.id, key, (layer.paint || {})[key]);
    });
    map.setSprite(new URL('src/basemap/sprites/' + flavor, document.baseURI).href);
    basemapFlavor = flavor;
}

// Map styling that follows the accessibility settings: dark mode switches the basemap and lightens labels;
// high contrast thickens paths and routes and darkens labels; bigger symbols enlarges points and icons and
// thickens lines; larger text enlarges building labels. Layers added later (labels and icons load
// asynchronously) call this too.
function applyMapSettings(map) {
    const strong = highContrast(), dark = darkMode();
    const k = settings.largeSymbols ? 1.6 : 1;
    setBasemapFlavor(map, dark ? 'dark' : 'white');
    const set = (layer, prop, value) => { if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value); };
    const setLayout = (layer, prop, value) => { if (map.getLayer(layer)) map.setLayoutProperty(layer, prop, value); };
    set('accessiblepaths-ext', 'line-width', (strong ? 4 : 2) * k);
    set('accessiblepaths-int', 'line-width', (strong ? 4 : 2) * k);
    set('paths', 'line-width', (strong ? 5 : 3) * k);
    set('buildings', 'fill-opacity', strong || dark ? 0.55 : 0.3);
    set('route-casing', 'line-width', (strong ? 13 : 10) * k);
    set('route-outdoor', 'line-width', (strong ? 9 : 6) * k);
    set('route-indoor', 'line-width', (strong ? 9 : 6) * k);
    set('route-stairs', 'line-width', (strong ? 10 : 7) * k);
    set('route-step-casing', 'line-width', 14 * k);
    set('route-step-line', 'line-width', 9 * k);
    set('route-step-point', 'circle-radius', 9 * k);
    // Point features: bigger, and outlined on the dark map so they stand out
    for (const [layer, radius] of [['bluelight', 5], ['elevators', 4], ['entrances', 4], ['curbcuts', 4], ['reststop', 5]]) {
        set(layer, 'circle-radius', radius * k);
        set(layer, 'circle-stroke-width', dark || strong ? 1.5 : 0);
        set(layer, 'circle-stroke-color', dark ? '#ffffff' : '#000000');
    }
    set('bluelight', 'circle-color', dark ? '#5c8dff' : '#0000ff');
    setLayout('bikerack', 'icon-size', 0.2 * k);
    setLayout('shuttlestop', 'icon-size', 0.04 * k);
    set('building-labels', 'text-color', dark ? '#f2f2f2' : strong ? '#000000' : '#1b1b1b');
    set('building-labels', 'text-halo-color', dark ? '#121212' : '#ffffff');
    set('building-labels', 'text-halo-width', strong ? 3 : 1.6);
    if (map.getLayer('building-labels')) {
        const k = settings.largerText ? 1.35 : 1;
        map.setLayoutProperty('building-labels', 'text-size', ['interpolate', ['linear'], ['zoom'], 16, 11 * k, 19, 15 * k]);
    }
}
