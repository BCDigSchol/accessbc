//Sets up zoom and geolocation controls on the map
function addMapControls(map) {
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true
    }), 'top-right');
    map.addControl(new ThreeDControl(), 'top-right');
    map.addControl(new LayersControl(), 'top-right');
}

// Opens and closes the map key (the legend), which is closed to start with so the map stays clear.
function setLegendOpen(open, { focus = true } = {}) {
    const legend = document.getElementById('legend');
    legend.hidden = !open;
    document.querySelectorAll('.layers-toggle').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (!focus) return;
    if (open) legend.querySelector('.legend-close')?.focus();
    else (document.querySelector('.layers-toggle') || document.getElementById('menu-toggle')).focus();
}

// "Layers" button on the map, for the legend
class LayersControl {
    onAdd() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layers-toggle';
        button.textContent = 'Layers';
        button.setAttribute('aria-label', 'Map layers');
        button.setAttribute('aria-controls', 'legend');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', () => setLegendOpen(document.getElementById('legend').hidden));
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        this.container.appendChild(button);
        return this.container;
    }

    onRemove() {
        this.container.remove();
    }
}

// Button that tilts the map to show buildings in 3D, and back. Tilting by hand also shows them.
class ThreeDControl {
    onAdd(map) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'three-d-toggle';
        button.textContent = '3D';
        button.setAttribute('aria-label', 'Show buildings in 3D');
        button.addEventListener('click', () => {
            moveMap(map, 'easeTo', map.getPitch() > 10 ? { pitch: 0, bearing: 0 } : { pitch: 60 });
        });
        const sync = () => {
            const tilted = map.getPitch() > 10;
            button.setAttribute('aria-pressed', String(tilted));
            if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', tilted ? 'visible' : 'none');
        };
        map.on('pitch', sync);
        sync();
        this.container = document.createElement('div');
        this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        this.container.appendChild(button);
        return this.container;
    }

    onRemove() {
        this.container.remove();
    }
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
    { id: 'entrance-links', name: 'Links to Entrances (not checked)', color: '#0F8554', category: 'Navigating Campus' },
    { id: 'accessiblepaths-int', name: 'Exterior Accessible Paths', color: '#0F8554', category: 'Navigating Campus' },
    { id: 'accessiblepaths-ext', name: 'Interior Accessible Paths', color: '#5F4690', category: 'Navigating Campus' }
];

// Make global variable for legend data
window.legendData = legendData;

//Creates the legend container and adds it to the map. Every control is a real button, so the legend
//works with a keyboard and screen readers: layer toggles report on/off (aria-pressed), and category
//headers report expanded/collapsed (aria-expanded).
function createLegend(containerId, legendData, map) {
    const legendContainer = document.getElementById(containerId);
    legendContainer.innerHTML = ''; // Clear existing legend content

    // Heading and close button (the legend opens from the Layers button on the map, or the menu)
    const header = document.createElement('div');
    header.className = 'legend-header';
    header.innerHTML = '<h2 id="legend-title">Map layers</h2><button type="button" class="close legend-close" aria-label="Close map layers">×</button>';
    header.querySelector('.legend-close').addEventListener('click', () => setLegendOpen(false));
    legendContainer.appendChild(header);
    legendContainer.addEventListener('keydown', (e) => { if (e.key === 'Escape') setLegendOpen(false); });

    // Main legend content wrapper
    const content = document.createElement('div');
    content.classList.add('legend-content');
    content.id = 'legend-body';
    legendContainer.appendChild(content);

    const setItem = (item, visible) => {
        item.classList.toggle('disabled', !visible);
        item.setAttribute('aria-pressed', String(visible));
    };

    // Add "collapse all" toggle button
    const collapseAllBtn = document.createElement('button');
    collapseAllBtn.type = 'button';
    collapseAllBtn.textContent = 'Collapse all ▼';
    collapseAllBtn.setAttribute('aria-expanded', 'true');
    collapseAllBtn.classList.add('legend-collapse-all-btn');

    let legendCollapsed = false;

    collapseAllBtn.addEventListener('click', () => {
        legendCollapsed = !legendCollapsed;

        content.querySelectorAll('.legend-section').forEach(section => {
            section.querySelector('.legend-category-content').classList.toggle('collapsed', legendCollapsed);
            const toggle = section.querySelector('.legend-category-toggle');
            if (toggle) {
                toggle.setAttribute('aria-expanded', String(!legendCollapsed));
                toggle.querySelector('.legend-arrow').textContent = legendCollapsed ? '►' : '▼';
            }
        });

        // Update all legend items and toggle map layer visibility
        legendData.forEach(layer => {
            const item = content.querySelector(`[data-layer-id="${layer.id}"]`);
            if (item) {
                map.setLayoutProperty(layer.id, 'visibility', legendCollapsed ? 'none' : 'visible');
                setItem(item, !legendCollapsed);
            }
        });

        collapseAllBtn.textContent = legendCollapsed ? 'Expand all ►' : 'Collapse all ▼';
        collapseAllBtn.setAttribute('aria-expanded', String(!legendCollapsed));
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
    Object.keys(categories).forEach((categoryName, index) => {
        const section = document.createElement('div');
        section.classList.add('legend-section');

        const itemsId = `legend-category-${index}`;
        const header = document.createElement('h3');
        header.classList.add('legend-subheader');
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.classList.add('legend-category-toggle');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-controls', itemsId);
        toggle.innerHTML = `<span class="legend-category-label"></span><span class="legend-arrow" aria-hidden="true">▼</span>`;
        toggle.querySelector('.legend-category-label').textContent = categoryName;
        header.appendChild(toggle);
        section.appendChild(header);

        const itemsContainer = document.createElement('div');
        itemsContainer.classList.add('legend-category-content');
        itemsContainer.id = itemsId;

        categories[categoryName].forEach(layer => {
            const item = document.createElement('button');
            item.type = 'button';
            item.classList.add('legend-item');
            item.dataset.layerId = layer.id;
            setItem(item, true);

            if (layer.icon) {
                const icon = document.createElement('img');
                icon.src = layer.icon;
                icon.alt = '';
                icon.classList.add('legend-icon');
                item.appendChild(icon);
            } else if (layer.color) {
                const colorBox = document.createElement('span');
                colorBox.classList.add('legend-color-box');
                colorBox.setAttribute('aria-hidden', 'true');
                colorBox.style.backgroundColor = layer.color;
                item.appendChild(colorBox);
            }

            const label = document.createElement('span');
            label.textContent = layer.name;
            item.appendChild(label);

            item.addEventListener('click', () => {
                const visible = map.getLayoutProperty(layer.id, 'visibility') === 'none';
                map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
                setItem(item, visible);
            });

            itemsContainer.appendChild(item);
        });

        section.appendChild(itemsContainer);
        content.appendChild(section);

        // The category header hides or shows all of its layers, and collapses or expands the list
        toggle.addEventListener('click', () => {
            const allLayers = categories[categoryName];
            const anyVisible = allLayers.some(layer => map.getLayoutProperty(layer.id, 'visibility') !== 'none');

            allLayers.forEach(layer => {
                const visibility = anyVisible ? 'none' : 'visible';
                map.setLayoutProperty(layer.id, 'visibility', visibility);
                const item = itemsContainer.querySelector(`[data-layer-id="${layer.id}"]`);
                if (item) setItem(item, visibility === 'visible');
            });

            const isCollapsed = itemsContainer.classList.toggle('collapsed');
            toggle.setAttribute('aria-expanded', String(!isCollapsed));
            toggle.querySelector('.legend-arrow').textContent = isCollapsed ? '►' : '▼';
        });
    });
}

//Set layers to be initially visible
function setLayerVisibility(map, layers, visibility) {
    layers.forEach(layerId => {
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}