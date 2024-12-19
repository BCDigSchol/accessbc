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
function createLegend(containerId, legendData, map) {
    const legendContainer = document.getElementById(containerId);
    legendContainer.innerHTML = ''; // Clear any existing legend content

    // Add a toggle button with an icon
    const toggleButton = document.createElement('div');
    toggleButton.classList.add('legend-toggle-button');
    legendContainer.appendChild(toggleButton);

    const collapseIndicator = document.createElement('span');
    collapseIndicator.classList.add('collapse-indicator');
    collapseIndicator.textContent = '▼ Hide Legend'; // Default collapsed state
    toggleButton.appendChild(collapseIndicator);

    // Collapsible content container
    const content = document.createElement('div');
    content.classList.add('legend-content'); // Renamed for clarity
    legendContainer.appendChild(content);

    toggleButton.addEventListener('click', () => {
        // Collapse the entire legend container
        legendContainer.classList.toggle('collapsed');
    
        // Collapse legend content
        content.classList.toggle('collapsed');
    
        // Collapse all legend items
        const legendItems = legendContainer.querySelectorAll('.legend-item');
        legendItems.forEach(item => {
            item.classList.toggle('collapsed');
        });
    
        // Update the indicator and/or icon based on the state
        if (legendContainer.classList.contains('collapsed')) {
            collapseIndicator.textContent = '▼ Show Legend'; // Collapsed state
        } else {
            collapseIndicator.textContent = '▲ Hide Legend'; // Expanded state
        }
    });

   legendData.forEach(layer => {
        const item = document.createElement('div');
        item.classList.add('legend-item');
        item.dataset.layerId = layer.id;

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

        item.addEventListener('click', () => {
            const layerId = layer.id;
            const visibility = map.getLayoutProperty(layerId, 'visibility');

            if (!visibility) {
                console.error(`Layer with ID "${layerId}" not found or visibility is not set.`);
                return;
            }

            if (visibility === 'visible') {
                map.setLayoutProperty(layerId, 'visibility', 'none');
                item.classList.add('inactive'); // Add a class to indicate the layer is hidden
            } else {
                map.setLayoutProperty(layerId, 'visibility', 'visible');
                item.classList.remove('inactive');
            }
        });
    });
}
//Dynamically update the legend based on the visible layers
function updateLegend(visibleLayers, legendData) {
    const legendContainer = document.getElementById('legend');
    legendContainer.innerHTML = ''; // Clear existing content

    legendData.forEach(layer => {
        const item = document.createElement('div');
        item.classList.add('legend-item');
        item.dataset.layerId = layer.id;

        // Check if layer is visible
        const isVisible = visibleLayers.includes(layer.id);

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

        // Add 'inactive' class if the layer is not visible
        if (!isVisible) {
            item.classList.add('inactive');
        }

        // Add click event to toggle visibility
        item.addEventListener('click', () => {
            const layerId = layer.id;
            const visibility = map.getLayoutProperty(layerId, 'visibility');

            if (visibility === 'visible') {
                map.setLayoutProperty(layerId, 'visibility', 'none');
                item.classList.add('inactive');
            } else {
                map.setLayoutProperty(layerId, 'visibility', 'visible');
                item.classList.remove('inactive');
            }
        });

        legendContainer.appendChild(item);
    });
}

//Set layer visibility
function setLayerVisibility(map, layers, visibility) {
    layers.forEach(layerId => {
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}