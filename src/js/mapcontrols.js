//CREATES ZOOM CONTROLS AND GEOLOCATION CONTROLS
function addMapControls(map) {
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    map.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true
    }), 'bottom-right');
}

//CREATES AND DYNAMICALLY UPDATES LEGEND
// Function to create the legend container and populate with initial data
function createLegend(containerId, legendData) {
    const legendContainer = document.getElementById(containerId);
    legendContainer.innerHTML = ''; // Clear any existing legend content

   legendData.forEach(layer => {
        const item = document.createElement('div');
        item.classList.add('legend-item');

        if (layer.icon) {
            const icon = document.createElement('img');
            icon.src = layer.icon;
            icon.classList.add('legend-icon');
            item.appendChild(icon);
        } else {
            const colorBox = document.createElement('div');
            colorBox.classList.add('legend-color-box');
            colorBox.style.backgroundColor = layer.color;
            item.appendChild(colorBox);
        }

        const label = document.createElement('span');
        label.textContent = layer.name;
        item.appendChild(label);

        legendContainer.appendChild(item);
    });
}
//Dynamically update the legend based on the visible layers
function updateLegend(visibleLayers, legendData) {
    const legendContainer = document.getElementById('legend');
    legendContainer.innerHTML = '';

    legendData.forEach(layer => {
        if (visibleLayers.includes(layer.id)) {
            const item = document.createElement('div');
            item.classList.add('legend-item');

            if (layer.icon) {
                const icon = document.createElement('img');
                icon.src = layer.icon;
                icon.style.width = '20px';
                icon.style.height = '20px';
                icon.style.marginRight = '5px';
                item.appendChild(icon);
            } else {
                const colorBox = document.createElement('div');
                colorBox.style.width = '20px';
                colorBox.style.height = '20px';
                colorBox.style.backgroundColor = layer.color;
                colorBox.style.marginRight = '5px';
                item.appendChild(colorBox);
            }

            const label = document.createElement('span');
            label.textContent = layer.name;
            item.appendChild(label);

            legendContainer.appendChild(item);
        }
    });
}

//Set layer visibility
function setLayerVisibility(map, layers, visibility) {
    layers.forEach(layerId => {
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}