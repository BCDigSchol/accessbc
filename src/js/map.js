document.addEventListener('DOMContentLoaded', function () {
    mapboxgl.accessToken = 'pk.eyJ1IjoiYmNkc2ctbGVjIiwiYSI6ImNsbjRrc3F6ejAxNDUya3F1NjMzMmliMzIifQ.YCTLzh1KRXr4P-9djuAMkg';
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/bcdsg-lec/cm3oohpoy00oc01r2hl6wgqwm',
        zoom: 15,
        center: [-71.168819, 42.336193]
    });
    window.map = map;
    map.on('load', () => {
    addMapControls(map);
    createLegend('legend', legendData, map);
    createElevationLegend('legend')
    addMapData(map);
    addPopupHandlers(map);
    addSidebarHandlers(map);
    setupElevationHandler(map);
    });
});