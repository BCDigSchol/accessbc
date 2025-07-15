//Sets up initialmap with all map functions called on load
document.addEventListener('DOMContentLoaded', function () {
    mapboxgl.accessToken = 'pk.eyJ1IjoiYmNkc2ctbGVjIiwiYSI6ImNtYmk5OHB0eDAyemkybXB5bmwwbWJucXUifQ.examOW7keLjA67etGpg1AQ';
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/bcdsg-lec/cm3oohpoy00oc01r2hl6wgqwm',
        zoom: 15,
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
    });
});
