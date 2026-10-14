// Search box (an accessible combobox: arrow keys move through suggestions, Enter picks, Escape closes).
// There are 3 kinds of suggestion:
// - Building: a building name. Picking one zooms to it and opens its information.
// - Predefined: building attribute fields like dining, single-use restrooms, lactation rooms, etc., which can
//   be associated with multiple buildings.
// - Description: each named resource in a building's description field, associated with only one building.

document.addEventListener('DOMContentLoaded', function () {
  // Predefined options added to dropdown, with the building field each one filters on
  const predefinedOptions = {
    'Vending Machines': 'Food_vend', 'Cafes': 'Food_cafe', 'Dining': 'Food_dinin',
    'Lactation Rooms': 'Lactation', 'Single-use Restrooms': 'Single_res',
    'Group Seating': 'Seating_gr', 'Individual Seating': 'Seating_in', 'Printing': 'Printing'
  };
  const excludedStrings = ['Student Resources:', 'Academic Programs:', 'Dining Options:'];

  const searchBar = document.getElementById('generic-search');
  const searchDropdown = document.getElementById('generic-dropdown');
  let buildings = []; // all building features, from the GeoJSON rather than the currently loaded map tiles
  let options = []; // {label, kind, value} currently shown
  let active = -1;

  fetch('src/geojson/buildings.geojson').then((r) => r.json()).then((data) => { buildings = data.features; });

  function allOptions() {
    const names = new Set(), resources = new Set();
    buildings.forEach(feature => {
      const name = (feature.properties.NAME || '').trim();
      if (name) names.add(name);
      (feature.properties.Descriptio || '').split('\n').forEach(resource => {
        if (resource.trim() && !excludedStrings.includes(resource.trim())) resources.add(resource.trim());
      });
    });
    return [
      ...Object.keys(predefinedOptions).map(label => ({ label, kind: 'Find all', value: label })),
      ...[...names].sort((a, b) => a.localeCompare(b)).map(label => ({ label, kind: 'Building', value: label })),
      ...[...resources].map(label => ({ label, kind: 'In a building', value: label })),
    ];
  }

  function setOpen(open) {
    searchDropdown.style.display = open ? 'block' : 'none';
    searchBar.setAttribute('aria-expanded', String(open));
    if (!open) {
      active = -1;
      searchBar.removeAttribute('aria-activedescendant');
    }
  }

  function updateDropdown(query) {
    const q = query.toLowerCase();
    options = allOptions().filter(option => option.label.toLowerCase().includes(q));
    searchDropdown.innerHTML = '';
    active = -1;
    searchBar.removeAttribute('aria-activedescendant');
    options.forEach((option, i) => {
      const div = document.createElement('div');
      div.id = `search-option-${i}`;
      div.setAttribute('role', 'option');
      div.setAttribute('aria-selected', 'false');
      div.innerHTML = '<span class="search-option-label"></span><span class="search-option-kind"></span>';
      div.querySelector('.search-option-label').textContent = option.label;
      div.querySelector('.search-option-kind').textContent = `, ${option.kind}`;
      div.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the search box
      div.addEventListener('click', () => handleSelection(option));
      searchDropdown.appendChild(div);
    });
    setOpen(options.length > 0);
  }

  function setActive(i) {
    const items = searchDropdown.querySelectorAll('[role="option"]');
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((item, k) => item.setAttribute('aria-selected', String(k === active)));
    searchBar.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({ block: 'nearest' });
  }

  searchBar.addEventListener('input', function () { updateDropdown(this.value); });
  searchBar.addEventListener('click', function () { updateDropdown(this.value); });
  searchBar.addEventListener('keydown', (e) => {
    const open = searchDropdown.style.display === 'block';
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) updateDropdown(searchBar.value); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive(active - 1); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); handleSelection(options[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  });

  function handleSelection(option) {
    searchBar.value = option.label;
    setOpen(false);
    if (option.kind === 'Find all') applyFilter(predefinedOptions[option.value]);
    else if (option.kind === 'Building') showBuilding(buildings.find(f => (f.properties.NAME || '').trim() === option.value), true);
    else showBuilding(buildings.find(f => (f.properties.Descriptio || '').includes(option.value)), false);
  }

  document.addEventListener('click', function (event) {
    if (!searchBar.contains(event.target) && !searchDropdown.contains(event.target)) setOpen(false);
  });

  function highlight(filter) {
    map.setFilter('buildings-highlighted', filter);
    map.setPaintProperty('buildings-highlighted', 'fill-color', '#994E95');
    map.setPaintProperty('buildings-highlighted', 'fill-opacity', 0.75);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'visible');
  }

  // Highlights buildings that have 'Yes' for a predefined field
  function applyFilter(field) {
    highlight(['==', ['get', field], 'Yes']);
  }

  // Highlights and zooms to one building; optionally opens its information too
  function showBuilding(feature, openInfo) {
    if (!feature) return clearHighlight();
    highlight(['==', ['get', 'NAME'], feature.properties.NAME]);
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const bounds = new maplibregl.LngLatBounds();
    polygons.forEach(polygon => polygon[0].forEach(coord => bounds.extend(coord)));
    moveMap(map, 'fitBounds', { bounds, padding: 50, maxZoom: 17 });
    if (openInfo) openBuildingInfo(feature.properties);
  }

  function clearHighlight() {
    map.setFilter('buildings-highlighted', ['==', ['get', 'NAME'], '']);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'none');
  }

  //Clears highlighted buildings
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.id = 'searchbar-clear-btn';
  clearBtn.style.marginLeft = '8px';
  clearBtn.type = 'button';
  clearBtn.setAttribute('aria-label', 'Clear search');
  searchBar.parentNode.insertBefore(clearBtn, searchDropdown.nextSibling);

  clearBtn.addEventListener('click', function () {
    searchBar.value = '';
    setOpen(false);
    clearHighlight();
  });
});
