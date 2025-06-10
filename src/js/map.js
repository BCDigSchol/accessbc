document.addEventListener('DOMContentLoaded', function () {
    mapboxgl.accessToken = 'pk.eyJ1IjoiYmNkc2ctbGVjIiwiYSI6ImNtYmk5OHB0eDAyemkybXB5bmwwbWJucXUifQ.examOW7keLjA67etGpg1AQ';
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/bcdsg-lec/cm3oohpoy00oc01r2hl6wgqwm',
        zoom: 15,
        center: [-71.170820, 42.336190]
    });
    window.map = map;

    const mq = window.matchMedia("(min-width: 800px)");

    function adjustZoom() {
        if (!map.isStyleLoaded()) return;
        if (mq.matches) {
            if (map.getZoom() !== 15) {
                map.setZoom(15);
            }
        } else {
            if (map.getZoom() !== 14.25) {
                map.setZoom(14.25);
                map.setCenter([-71.170020, 42.332490]);
            }
        }
        map.resize();
    }

    map.on('load', () => {
        addMapControls(map);
        createLegend('legend', legendData, map);
        createElevationLegend('legend');
        addMapData(map);
        addPopupHandlers(map);
        addSidebarHandlers(map);
        setupElevationHandler(map);

        adjustZoom(); // run on load
    });

    // Listen to window resize events to re-apply zoom level
    window.addEventListener('resize', adjustZoom);

    // Optional: Listen to changes in the media query itself (better than resize)
    mq.addEventListener('change', adjustZoom);
});
