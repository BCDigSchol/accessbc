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

//Set Legend Data
const legendData = [
    { id: 'shuttlestop', name: 'Shuttle Stops', icon: 'src/icons/shuttle.png', category: 'Transportation' },
    { id: 'bikerack', name: 'Bike Racks', icon: 'src/icons/bike.png', category: 'Transportation' },
    { id: 'bluelight', name: 'Bluelights', color: '#0000ff', category: 'Campus Resources' },
    { id: 'reststop', name: 'Outdoor Seating', color: '#73AF48', category: 'Campus Resources' },
    { id: 'elevators', name: 'Elevators', color: '#94346E', category: 'Navigating Campus' },
    { id: 'entrances', name: 'Accessible Entrances', color: '#f97b72', category: 'Navigating Campus' },
    { id: 'paths', name: 'Stairs', color: '#F2B701', category: 'Navigating Campus' },
    { id: 'curbcuts', name: 'Curb Cuts', color: '#3969AC', category: 'Navigating Campus' },
    { id: 'accessiblepaths', name: 'Interior Accessible Paths', color: '#0F8554', category: 'Navigating Campus' },
    { id: 'accessiblepaths', name: 'Exterior Accessible Paths', color: '#5F4690', category: 'Navigating Campus' }
];

// Make global
window.legendData = legendData;

function createLegend(containerId, legendData, map) {
    const legendContainer = document.getElementById(containerId);
    legendContainer.innerHTML = ''; // Clear existing legend content

    // Main legend content wrapper
    const content = document.createElement('div');
    content.classList.add('legend-content');
    legendContainer.appendChild(content);

    // Group legend items by category
    const categories = {
        'Transportation': [],
        'Navigating Campus': [],
        'Campus Resources': []
    };

    legendData.forEach(layer => {
        if (categories[layer.category]) {
            categories[layer.category].push(layer);
        }
    });

    Object.keys(categories).forEach(categoryName => {
        const section = document.createElement('div');
        section.classList.add('legend-section');

        const header = document.createElement('h4');
        header.classList.add('legend-subheader');
        
        const toggleSpan = document.createElement('span');
        toggleSpan.textContent = '▼';
        toggleSpan.style.marginLeft = '0.5rem';
        toggleSpan.style.cursor = 'pointer';

        const headerLabel = document.createElement('span');
        headerLabel.textContent = categoryName;
        headerLabel.classList.add('legend-category-label');
        headerLabel.style.cursor = 'pointer';
        headerLabel.style.fontWeight = 'bold';

        header.textContent = '';
        header.appendChild(headerLabel);
        header.appendChild(toggleSpan);

        header.appendChild(toggleSpan);
        section.appendChild(header);

        const itemsContainer = document.createElement('div');
        itemsContainer.classList.add('legend-category-content');

        categories[categoryName].forEach(layer => {
            const item = document.createElement('div');
            item.classList.add('legend-item');
            item.dataset.layerId = layer.id;

            if (layer.icon) {
                const icon = document.createElement('img');
                icon.src = layer.icon;
                icon.classList.add('legend-icon');
                item.appendChild(icon);
            } else if (layer.color) {
                const colorBox = document.createElement('div');
                colorBox.classList.add('legend-color-box');
                colorBox.style.backgroundColor = layer.color;
                item.appendChild(colorBox);
            }

            const label = document.createElement('span');
            label.textContent = layer.name;
            item.appendChild(label);

            // Add interactivity: toggle layer visibility
            item.addEventListener('click', () => {
                const layerId = layer.id;
                const visibility = map.getLayoutProperty(layerId, 'visibility');

                if (visibility === 'none') {
                    map.setLayoutProperty(layerId, 'visibility', 'visible');
                    item.classList.remove('disabled');
                } else {
                    map.setLayoutProperty(layerId, 'visibility', 'none');
                    item.classList.add('disabled');
                }
            });

                    itemsContainer.appendChild(item);
                });

        section.appendChild(itemsContainer);
        content.appendChild(section);

        // Toggle collapse behavior for individual categories
        header.addEventListener('click', () => {
            const isCollapsed = itemsContainer.classList.toggle('collapsed');
            toggleSpan.textContent = isCollapsed ? '►' : '▼';
        });
        // Toggle collapse behavior (clicking arrow)
        toggleSpan.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent category toggle when collapsing
            const isCollapsed = itemsContainer.classList.toggle('collapsed');
            toggleSpan.textContent = isCollapsed ? '►' : '▼';
        });

        // Toggle all layers in category (clicking label)
        headerLabel.addEventListener('click', () => {
            const allLayers = categories[categoryName];
            const anyVisible = allLayers.some(layer => map.getLayoutProperty(layer.id, 'visibility') !== 'none');

            allLayers.forEach(layer => {
                const visibility = anyVisible ? 'none' : 'visible';
                map.setLayoutProperty(layer.id, 'visibility', visibility);

                // Update legend item styling
                const item = itemsContainer.querySelector(`[data-layer-id="${layer.id}"]`);
                if (visibility === 'none') {
                    item.classList.add('disabled');
                } else {
                    item.classList.remove('disabled');
                }
            });
        });
    });
}

//Set layer visibility
function setLayerVisibility(map, layers, visibility) {
    layers.forEach(layerId => {
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}