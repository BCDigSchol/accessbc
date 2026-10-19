// "Where to?": one search box for everything, as in other map apps (an accessible combobox: arrow keys move
// through suggestions, Enter picks, Escape closes). Suggestions are:
// - kinds of thing (restrooms, food, elevators...): picking one lists the nearest few (nearby.js)
// - buildings: picking one shows the route there, from your location; buildings without a mapped accessible
//   entrance open their information instead, since they can't be routed to yet
// - resources named in a building's description ("Career Center"): the route to that building

let whereToBuildings = []; // all building features, from the GeoJSON rather than the currently loaded map tiles

function clearWhereTo() {
  document.getElementById('where-to').value = '';
  document.getElementById('where-to-clear').hidden = true;
  if (window.map?.getLayer('buildings-highlighted')) {
    map.setFilter('buildings-highlighted', ['==', ['get', 'NAME'], '']);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'none');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const excludedStrings = ['Student Resources:', 'Academic Programs:', 'Dining Options:'];
  const input = document.getElementById('where-to');
  const list = document.getElementById('where-to-list');
  const clearButton = document.getElementById('where-to-clear');
  let options = []; // {label, kind, value} currently shown
  let active = -1;

  fetch('src/geojson/buildings.geojson').then((r) => r.json()).then((data) => { whereToBuildings = data.features; });

  // Your saved and recent places first, then the kinds of thing
  const placeOptions = () => placeList().map((p) => ({ label: p.name, kind: p.kind === 'Saved' ? 'Saved place' : 'Recent', dest: p.dest }));
  const kindOptions = () => [...placeOptions(), ...Object.entries(NEARBY_KINDS).map(([key, kind]) => ({ label: kind.label, kind: 'Find the nearest', value: key }))];
  function allOptions() {
    const names = new Set(), resources = new Map();
    whereToBuildings.forEach((feature) => {
      const name = (feature.properties.NAME || '').trim();
      if (!name) return;
      names.add(name);
      (feature.properties.Descriptio || '').split('\n').forEach((line) => {
        const resource = line.trim();
        if (resource && !excludedStrings.includes(resource) && !resources.has(resource)) resources.set(resource, name);
      });
    });
    return [
      ...kindOptions(),
      ...[...names].sort((a, b) => a.localeCompare(b)).map((label) => ({ label, kind: 'Building', value: label })),
      ...[...resources].map(([label, building]) => ({ label, kind: `In ${building}`, value: building })),
    ];
  }

  function setOpen(open) {
    list.style.display = open ? 'block' : 'none';
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  // With nothing typed, suggest the kinds of thing; otherwise everything that matches, kinds and buildings first
  function update(query) {
    const q = query.trim().toLowerCase();
    options = q ? allOptions().filter((option) => option.label.toLowerCase().includes(q)).slice(0, 40) : kindOptions();
    list.innerHTML = '';
    active = -1;
    input.removeAttribute('aria-activedescendant');
    options.forEach((option, i) => {
      const item = document.createElement('div');
      item.id = `where-to-option-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.innerHTML = '<span class="search-option-label"></span><span class="search-option-kind"></span>';
      item.querySelector('.search-option-label').textContent = option.label;
      item.querySelector('.search-option-kind').textContent = `, ${option.kind}`;
      item.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the search box
      item.addEventListener('click', () => choose(option));
      list.appendChild(item);
    });
    setOpen(options.length > 0);
  }

  function setActive(i) {
    const items = list.querySelectorAll('[role="option"]');
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((item, k) => item.setAttribute('aria-selected', String(k === active)));
    input.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    clearButton.hidden = !input.value;
    update(input.value);
  });
  input.addEventListener('click', () => update(input.value));
  input.addEventListener('keydown', (e) => {
    const open = list.style.display === 'block';
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) update(input.value); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) setActive(active - 1); }
    else if (e.key === 'Enter' && open) {
      e.preventDefault();
      // Enter with nothing highlighted takes the first suggestion
      if (options.length) choose(options[Math.max(0, active)]);
    } else if (e.key === 'Escape') setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) setOpen(false);
  });
  clearButton.addEventListener('click', () => {
    clearWhereTo();
    input.focus();
    update('');
  });

  function choose(option) {
    setOpen(false);
    if (!routing) return;
    if (option.dest) return goToPlace(option.dest);
    if (option.kind === 'Find the nearest') {
      input.value = option.label;
      clearButton.hidden = false;
      return openNearby(option.value);
    }
    const feature = whereToBuildings.find((f) => (f.properties.NAME || '').trim() === option.value);
    if (!feature) return;
    input.value = option.value;
    clearButton.hidden = false;
    showBuilding(feature);
    if (!isRoutable(option.value)) return openBuildingInfo(feature.properties);
    routing.place = null;
    document.getElementById('route-to').value = option.value;
    updateRoute(window.map);
    document.getElementById('route-title').focus();
  }

  // Highlights a building and brings it into view
  function showBuilding(feature) {
    map.setFilter('buildings-highlighted', ['==', ['get', 'NAME'], feature.properties.NAME]);
    map.setPaintProperty('buildings-highlighted', 'fill-color', '#994E95');
    map.setPaintProperty('buildings-highlighted', 'fill-opacity', 0.75);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'visible');
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const bounds = new maplibregl.LngLatBounds();
    polygons.forEach((polygon) => polygon[0].forEach((coord) => bounds.extend(coord)));
    moveMap(map, 'fitBounds', { bounds, padding: unobstructedPadding(map), maxZoom: 17 });
  }
});
