//Sets up zoom and geolocation controls on the map
function addMapControls(map) {
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true
    }), 'top-right');
}

//LEGEND FUNCTIONS

//Set Legend data with patches and associated categories
const legendData = [
    { id: 'shuttlestop', name: 'Shuttle Stops', icon: 'src/icons/shuttle.png', category: 'Transportation' },
    { id: 'bikerack', name: 'Bike Racks', icon: 'src/icons/bike.png', category: 'Transportation' },
    { id: 'bluelight', name: 'Bluelights', color: '#0000ff', category: 'Campus Resources' },
    { id: 'reststop', name: 'Outdoor Seating', color: '#73AF48', category: 'Campus Resources' },
    { id: 'elevators', name: 'Elevators', color: '#94346E', category: 'Navigating Campus' },
    { id: 'entrances', name: 'Accessible Entrances', color: '#f97b72', category: 'Navigating Campus' },
    { id: 'paths', name: 'Stairs', color: '#F2B701', category: 'Navigating Campus' },
    { id: 'curbcuts', name: 'Curb Cuts', color: '#3969AC', category: 'Navigating Campus' },
    { id: 'accessiblepaths-int', name: 'Exterior Accessible Paths', color: '#0F8554', category: 'Navigating Campus' },
    { id: 'accessiblepaths-ext', name: 'Interior Accessible Paths', color: '#5F4690', category: 'Navigating Campus' }
];

// Make global variable for legend data
window.legendData = legendData;

//Creates the legend container and adds it to the map
function createLegend(containerId, legendData, map) {
    const legendContainer = document.getElementById(containerId);
    legendContainer.innerHTML = ''; // Clear existing legend content

    // Main legend content wrapper
    const content = document.createElement('div');
    content.classList.add('legend-content');
    legendContainer.appendChild(content);

    // Add "collapse all" toggle button
    const collapseAllBtn = document.createElement('button');
    collapseAllBtn.textContent = 'Collapse all ▼';
    collapseAllBtn.style.background = 'none';
    collapseAllBtn.style.border = 'none';
    collapseAllBtn.style.color = '#888';
    collapseAllBtn.style.fontStyle = 'italic';
    collapseAllBtn.style.cursor = 'pointer';
    collapseAllBtn.style.marginBottom = '0.5rem';
    collapseAllBtn.style.alignSelf = 'flex-end';
    collapseAllBtn.classList.add('legend-collapse-all-btn');

    let legendCollapsed = false;

    collapseAllBtn.addEventListener('click', () => {
    legendCollapsed = !legendCollapsed;

    const allSections = content.querySelectorAll('.legend-section');

    allSections.forEach(section => {
        const itemsContainer = section.querySelector('.legend-category-content');
        const toggleSpan = section.querySelector('span:last-child');
        if (legendCollapsed) {
            itemsContainer.classList.add('collapsed');
        } else {
            itemsContainer.classList.remove('collapsed');
        }
    });

    // Update all legend items and toggle map layer visibility
    legendData.forEach(layer => {
        const item = content.querySelector(`[data-layer-id="${layer.id}"]`);
        if (item) {
            if (legendCollapsed) {
                map.setLayoutProperty(layer.id, 'visibility', 'none');
                item.classList.add('disabled');
            } else {
                map.setLayoutProperty(layer.id, 'visibility', 'visible');
                item.classList.remove('disabled');
            }
        }
    });

    collapseAllBtn.textContent = legendCollapsed ? 'Expand all ►' : 'Collapse all ▼';
    });

    content.appendChild(collapseAllBtn);

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
    //Handle toggle and visibility functions for legend items and categories
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

        // Handle clicking either the category label or the arrow
        header.addEventListener('click', () => {
     
            const allLayers = categories[categoryName];
            const anyVisible = allLayers.some(layer => map.getLayoutProperty(layer.id, 'visibility') !== 'none');

            allLayers.forEach(layer => {
                const visibility = anyVisible ? 'none' : 'visible';
                map.setLayoutProperty(layer.id, 'visibility', visibility);

   
                const item = itemsContainer.querySelector(`[data-layer-id="${layer.id}"]`);
                if (item) {
                    item.classList.toggle('disabled', visibility === 'none');
                }
            });

            const isCollapsed = itemsContainer.classList.toggle('collapsed');
            toggleSpan.textContent = isCollapsed ? '►' : '▼';
        });
    });
}

//Set layers to be initially visible
function setLayerVisibility(map, layers, visibility) {
    layers.forEach(layerId => {
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}