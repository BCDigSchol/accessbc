// "Where to?": one search box for everything, as in other map apps (an accessible combobox: arrow keys move
// through suggestions, Enter picks, Escape closes). Suggestions are:
// - kinds of thing (restrooms, food, elevators...): picking one lists the nearest few (nearby.js)
// - buildings: picking one shows the route there, from your location; buildings without a mapped accessible
//   entrance open their information instead, since they can't be routed to yet
// - resources named in a building's description ("Career Center"): the route to that building

let whereToBuildings = []; // all building features, from the GeoJSON rather than the currently loaded map tiles

// How names are compared when searching: without apostrophes, accents, punctuation or spaces, so "oneill" finds
// O'Neill Library, "mc elroy" McElroy Commons, and "st mary" St. Mary's Hall
const searchKey = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// Names matching what's typed: those starting with it first, then those with a word starting with it ("live"
// finds Lower Live), then the rest ("lower" in Mayflower), each keeping their order
function searchMatches(items, query, label = (item) => item.label) {
  const q = searchKey(query);
  if (!q) return [];
  const tier = (name) => {
    const key = searchKey(name);
    if (key.startsWith(q)) return 0;
    const words = String(name).split(/[\s@&/,()-]+/).map(searchKey).filter(Boolean);
    if (words.some((_, i) => words.slice(i).join('').startsWith(q))) return 1;
    return key.includes(q) ? 2 : -1;
  };
  const tiered = items.map((item) => ({ item, t: tier(label(item)) })).filter((x) => x.t >= 0);
  return [0, 1, 2].flatMap((t) => tiered.filter((x) => x.t === t).map((x) => x.item));
}

// What's named in a building's description, with the heading it's under: [{name, section}] ("Lower Live", "Dining")
function buildingContents(feature) {
  let section = '';
  return (feature.properties.Descriptio || '').split('\n').map((l) => l.trim()).filter(Boolean).flatMap((line) => {
    if (line.endsWith(':')) { section = line.slice(0, -1); return []; }
    return [{ name: line, section }];
  });
}

function clearWhereTo() {
  document.getElementById('where-to').value = '';
  document.getElementById('where-to-clear').hidden = true;
  if (window.map?.getLayer('buildings-highlighted')) {
    map.setFilter('buildings-highlighted', ['==', ['get', 'NAME'], '']);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'none');
  }
}

document.addEventListener('DOMContentLoaded', function () {
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
      for (const { name: resource, section } of buildingContents(feature)) {
        if (!resources.has(resource)) resources.set(resource, { building: name, food: section === 'Dining Options' });
      }
    });
    // T stations, by name ("Reservoir T station")
    const stations = (typeof routePoints !== 'undefined' && routePoints?.['mbta-stations']?.features || [])
      .map((f) => ({ label: stationLabel(f), kind: `T station, ${f.properties.Lines}`, station: f }));
    // Messina College, on the Brookline campus: no paths there yet, so it shows the campus and says so
    const campuses = [{ label: 'Messina College', kind: 'Brookline campus, 400 Heath Street', campus: 'brookline' }];
    return [
      ...kindOptions(),
      ...campuses,
      ...stations,
      ...[...names].sort((a, b) => a.localeCompare(b)).map((label) => ({ label, kind: 'Building', value: label })),
      // Food places, offices, departments: straight to their building ("Lower Live, food in John M. Corcoran Commons")
      ...[...resources].map(([label, { building, food }]) => ({ label, kind: `${food ? 'Food' : 'In'} ${food ? 'in ' : ''}${building}`, value: building, inside: label })),
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
    options = query.trim() ? searchMatches(allOptions(), query).slice(0, 40) : kindOptions();
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
    if (option.station) return goToPlace({ label: option.label, lonlat: option.station.geometry.coordinates });
    if (option.campus === 'brookline') {
      handleBrooklineClick();
      input.value = option.label;
      clearButton.hidden = false;
      setView('route');
      document.getElementById('route-title').textContent = 'Messina College';
      showResult(`<p>Messina College is on BC’s Brookline campus, 400 Heath Street. Its buildings are on the map; select one for its information.</p>
        <p class="route-warning">Walking directions to and around the Brookline campus aren’t available yet: its paths haven’t been mapped. The BC shuttle (Brookline Campus route) runs between Conte Forum and the campus.</p>`);
      document.getElementById('route-title').focus();
      return;
    }
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
    routing.toInside = option.inside ? { name: option.inside, building: option.value } : null;
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
