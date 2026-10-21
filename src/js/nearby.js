// "Find nearby": the closest vending machine, restroom, bench, etc. by walking distance on the accessible
// network (honouring the route options), measured from your location, from your starting building, or
// along your current route. Each result can become your destination, or a stop on the way.

const NEARBY_KINDS = {
  vending: { label: 'Vending machines', fields: ['Food_vend'] },
  cafe: { label: 'Cafés', fields: ['Food_cafe'] },
  dining: { label: 'Dining halls', fields: ['Food_dinin'] },
  restroom: { label: 'Single-stall restrooms', fields: ['Single_res'] },
  food: { label: 'Food and vending', fields: ['Food_vend', 'Food_cafe', 'Food_dinin'] },
  lactation: { label: 'Lactation rooms', fields: ['Lactation'] },
  printing: { label: 'Printing', fields: ['Printing'] },
  seating: { label: 'Indoor seating', fields: ['Seating_gr', 'Seating_in'] },
  benches: { label: 'Outdoor seating', source: 'reststop', name: 'Outdoor seating' },
  bluelights: { label: 'Blue-light emergency phones', source: 'bluelights', name: 'Blue-light phone' },
  shuttle: { label: 'Shuttle stops', source: 'shuttlestops', name: 'Shuttle stop' },
  tstation: { label: 'T stations (Green Line)', source: 'mbta-stations', name: 'T station', city: true }, // off campus: on city sidewalks
  elevators: { label: 'Elevators', source: 'elevators', name: 'Elevator' },
};
const SNAP_TO_PATH_M = 40; // a point feature counts if it's this close to a mapped path
const NEARBY_RESULTS = 5;
let nearbyResults = [];
let nearbyMarker = null;
let nearbyFromYou = false; // whether the last search measured from your location
let nearbyFromBuilding = null; // or the building it measured from
let nearbyChosenBuilding = null; // a building picked under Near, used again next time (e.g. when off campus)

// Candidate places for a kind on a graph: [{label, building?, lonlat, nodes, offset}], cached per graph.
function nearbyCandidates(graph, kind) {
  graph.nearby ||= {};
  if (graph.nearby[kind]) return graph.nearby[kind];
  const { module, data } = routing;
  const config = NEARBY_KINDS[kind];
  let candidates;
  if (config.fields) {
    const has = new Set(data.buildings.filter((b) => config.fields.some((f) => b.properties[f] === 'Yes')).map((b) => (b.properties.NAME || '').trim()));
    const byBuilding = {};
    for (const e of graph.entrances) if (has.has(e.building)) (byBuilding[e.building] ||= []).push(e.node);
    candidates = Object.entries(byBuilding).map(([building, nodes]) => ({ label: building, building, nodes, offset: 0, lonlat: graph.nodes[nodes[0]] }));
  } else {
    const features = (routePoints && routePoints[config.source]?.features) || [];
    candidates = [];
    for (const f of features) {
      const lonlat = f.geometry.coordinates;
      const near = module.nearestNode(graph, lonlat);
      if (near.d > SNAP_TO_PATH_M) continue;
      const building = module.nearestBuilding(graph.buildings, module.proj(lonlat));
      const where = kind === 'elevators' && (f.properties.Building || '').trim() ? `in ${f.properties.Building.trim()}` : `near ${building.name}`;
      const label = kind === 'shuttle' && f.properties.Name ? `${f.properties.Name} shuttle stop`
        : kind === 'tstation' ? `${f.properties.Name} T station` : `${config.name} ${where}`;
      // How it reads mid-sentence ("Arrive at the outdoor seating near Gasson Hall")
      const phrase = placePhrase(label);
      candidates.push({ label, phrase, lonlat, nodes: [near.node], offset: near.d, feature: f });
    }
  }
  return (graph.nearby[kind] = candidates);
}

// A one-line message in the results area, announced to screen readers.
function nearbyMessage(out, html) {
  out.innerHTML = html;
  announce(out.textContent.trim());
}

async function findNearby(map) {
  const { module } = routing;
  const kind = document.getElementById('nearby-kind').value;
  const near = document.getElementById('nearby-from').value;
  const options = routeOptions();
  const out = document.getElementById('nearby-results');
  // Things off campus (T stations) are measured on city sidewalks too
  let graph = (NEARBY_KINDS[kind].city && await cityGraph()) || currentGraph();
  out.innerHTML = '<p>Searching…</p>';

  // Where to measure from: your location, your route, or a building chosen under Near
  let sources, startOffset = 0, fromWhat, here = null, start = null;
  if (near === 'route') {
    if (!routing.current) return nearbyMessage(out, '<p>There’s no route yet. Choose My location or a building under Near.</p>');
    // On the route's own walking graph (campus or city), leaving out shuttle and train ride nodes
    graph = routing.current.graph.base || routing.current.graph;
    sources = routing.current.route.nodes.filter((n) => n < graph.nodes.length);
    fromWhat = 'route';
  } else if (near === 'me') {
    out.innerHTML = '<p>Finding your location…</p>';
    try {
      here = await getPosition();
    } catch {
      // Straight to the Near list, to pick a building to search from instead
      nearbyMessage(out, '<p>Your location isn’t available (check that location access is allowed for this site). Choose a building under <strong>Near</strong> to search from there.</p>');
      document.getElementById('nearby-from').focus();
      return;
    }
    start = module.nearestNode(graph, here);
    sources = [start.node];
    startOffset = start.d;
    fromWhat = 'you';
  } else {
    sources = graph.entrances.filter((e) => e.building === near).map((e) => e.node);
    if (!sources.length) return nearbyMessage(out, `<p>${escapeHtml(near)} has no mapped accessible entrance, so walking distances from it can’t be measured.</p>`);
    fromWhat = near;
  }
  if (Number.isFinite(options.maxGrade)) await ensureGrades(graph);
  // Within the route options; if nothing is, without the slope and indoor limits (and say so)
  let relaxed = false;
  const search = (opts) => {
    const distances = module.walkingDistances(graph, sources, edgeCost(graph, opts));
    return nearbyCandidates(graph, kind)
      .map((c) => ({ ...c, distance: Math.min(...c.nodes.map((n) => distances[n])) + c.offset + startOffset }))
      .filter((c) => Number.isFinite(c.distance))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEARBY_RESULTS);
  };
  const searchRelaxing = () => {
    relaxed = false;
    if (start && start.d > MAX_START_DISTANCE_M) return []; // too far from these paths to measure from
    let results = search(options);
    if (!results.length && (Number.isFinite(options.maxGrade) || options.indoor === 'avoid')) {
      results = search({ ...options, maxGrade: Infinity, indoor: 'auto' });
      relaxed = results.length > 0;
    }
    return results;
  };
  nearbyResults = searchRelaxing();
  // From your location, off campus or on a stretch of path cut off from the rest: city sidewalks too (as directions do)
  if (fromWhat === 'you' && !nearbyResults.length) {
    const city = await cityGraph();
    if (city) {
      graph = city;
      start = module.nearestNode(graph, here);
      sources = [start.node];
      startOffset = start.d;
      if (Number.isFinite(options.maxGrade)) await ensureGrades(graph);
      nearbyResults = searchRelaxing();
    }
  }
  if (fromWhat === 'you' && start.d > MAX_START_DISTANCE_M) {
    nearbyMessage(out, `<p>You’re ${feet(start.d)} from the nearest mapped path, so walking distances from you can’t be measured. Choose a building under <strong>Near</strong> to search from there.</p>`);
    document.getElementById('nearby-from').focus();
    return;
  }
  nearbyFromYou = fromWhat === 'you';
  nearbyFromBuilding = fromWhat !== 'you' && fromWhat !== 'route' ? fromWhat : null;

  const label = NEARBY_KINDS[kind].label.toLowerCase();
  if (!nearbyResults.length) {
    return nearbyMessage(out, `<p>No ${label} can be reached on mapped ${options.stairs ? '' : 'accessible '}paths from ${fromWhat === 'route' ? 'your route' : fromWhat === 'you' ? 'your location' : escapeHtml(fromWhat)}.</p>`);
  }
  const along = fromWhat === 'route';
  // Along a route, the start and destination buildings are already on it: say so, rather than offer them as stops.
  const ends = along
    ? { [document.getElementById('route-from').value]: 'your starting building', [routing.current.to]: 'your destination' }
    : nearbyFromBuilding ? { [nearbyFromBuilding]: 'in the building you searched from' } : {};
  const items = nearbyResults.map((r, i) => {
    const end = r.building && ends[r.building];
    const how = end || (along ? (r.distance < 15 ? 'on your route' : `${feet(r.distance)} off your route`) : `${feet(r.distance)} walk`);
    const broken = r.feature && isReportedBroken(r.feature) ? ' <span class="nearby-broken">(reported not working)</span>'
      : r.feature?.properties.Wheelchair === 'no' ? ' <span class="nearby-broken">(not wheelchair accessible)</span>' : '';
    return `<li>
      <span class="nearby-name">${escapeHtml(r.label)}</span>${broken} <span class="nearby-distance">${how}</span>
      <span class="nearby-actions">
        ${along && !end ? `<button type="button" data-nearby-stop="${i}" aria-label="Add ${escapeHtml(r.label)} as a stop">Add as a stop</button>` : ''}
        ${end ? '' : `<button type="button" data-nearby-go="${i}" aria-label="Directions to ${escapeHtml(r.label)}">Directions</button>`}
        <button type="button" data-nearby-show="${i}" aria-label="Show ${escapeHtml(r.label)} on the map">Show</button>
      </span>
    </li>`;
  });
  // Looking for a blue-light phone: the numbers to call come first
  const relaxedNote = relaxed ? '<p class="route-warning">None can be reached within your slope and indoor settings, so these may involve steeper slopes.</p>' : '';
  out.innerHTML = `${kind === 'bluelights' ? emergencyCallLinks() : ''}${relaxedNote}<ol class="nearby-list" aria-label="Nearest ${label}${along ? ' along your route' : ''}">${items.join('')}</ol>`;
  const first = nearbyResults[0];
  const said = `The nearest is ${first.label}${first.feature && isReportedBroken(first.feature) ? ' (reported not working)' : ''}, ${along ? (first.distance < 15 ? 'on your route' : `${feet(first.distance)} off your route`) : `${feet(first.distance)} away`}.`;
  announce(`${nearbyResults.length} ${nearbyResults.length === 1 ? 'result' : 'results'} found. ${said}`);
  if (guide.active) speak(said); // read aloud only while walking (adding a stop mid-trip)
}

// The results view: the nearest things of a kind, along your route when there is one, else near you. With no kind
// (adding a stop mid-trip), the student picks one. Back returns to wherever they came from.
let nearbyReturn = 'home';
function setResultsTitle() {
  const kind = NEARBY_KINDS[document.getElementById('nearby-kind').value];
  document.getElementById('results-title').textContent = `Nearest ${kind.label.toLowerCase()}`;
}
// The Near list: My location, Along my route (when there is one), then every building that can be routed from
function fillNearbyFrom() {
  const select = document.getElementById('nearby-from');
  const keep = select.value;
  select.innerHTML = `<option value="me">My location</option>${routing.current ? '<option value="route">Along my route</option>' : ''}`
    + (routing.buildingOptions || '').replace(/<optgroup label="([^"]+)">/g, '<optgroup label="A building: $1">');
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
}

function openNearby(kind, { near } = {}) {
  const kindSelect = document.getElementById('nearby-kind');
  if (kind) kindSelect.value = kind;
  fillNearbyFrom();
  const listed = (v) => v && [...document.getElementById('nearby-from').options].some((o) => o.value === v);
  document.getElementById('nearby-from').value = near || (routing.current ? 'route' : listed(nearbyChosenBuilding) ? nearbyChosenBuilding : 'me');
  nearbyReturn = guide.active ? 'walk' : routing.current ? 'route' : 'home';
  document.getElementById('nearby-results').innerHTML = '';
  // Along a route, a stop can also be a building, typed in
  document.getElementById('stop-building').hidden = !routing.current;
  document.getElementById('stop-building-search').value = '';
  showStopBuildings('');
  setView('results');
  setResultsTitle();
  if (!kind) return kindSelect.focus();
  document.getElementById('results-title').focus();
  findNearby(window.map);
}

function showNearbyOnMap(map, result) {
  if (nearbyMarker) nearbyMarker.remove();
  nearbyMarker = new maplibregl.Marker({ color: '#6b2fa3' }).setLngLat(result.lonlat).addTo(map);
  moveMap(map, 'flyTo', { center: result.lonlat, zoom: Math.max(map.getZoom(), 17.5) });
}

// Buildings that can be a stop on the current route, matching what's typed (also by what's in them: "Career Center")
function stopBuildingMatches(query) {
  const graph = currentGraph();
  const routable = new Set(graph.entrances.map((e) => e.building));
  const ends = new Set([document.getElementById('route-from').value, routing.current?.to]);
  const names = [...routable].filter((b) => !ends.has(b)).sort((a, b) => a.localeCompare(b)).map((b) => ({ label: b, building: b }));
  const inside = whereToBuildings.flatMap((f) => {
    const b = (f.properties.NAME || '').trim();
    if (!routable.has(b) || ends.has(b)) return [];
    return (f.properties.Descriptio || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.endsWith(':')).map((l) => ({ label: l, building: b }));
  });
  const seen = new Set();
  return searchMatches([...names, ...inside], query).filter((m) => !seen.has(m.building) && seen.add(m.building)).slice(0, 8);
}

let stopBuildings = [];
function showStopBuildings(query) {
  const list = document.getElementById('stop-building-matches');
  stopBuildings = query.trim() ? stopBuildingMatches(query) : [];
  list.innerHTML = stopBuildings.map((m, i) => {
    const name = m.label === m.building ? escapeHtml(m.building) : `${escapeHtml(m.label)} <span class="nearby-distance">in ${escapeHtml(m.building)}</span>`;
    return `<li><span class="nearby-name">${name}</span><span class="nearby-actions"><button type="button" data-stop-building="${i}" aria-label="Add ${escapeHtml(m.building)} as a stop">Add as a stop</button></span></li>`;
  }).join('');
  document.getElementById('stop-building-status').textContent = !query.trim() ? ''
    : stopBuildings.length ? `${stopBuildings.length} ${stopBuildings.length === 1 ? 'building matches' : 'buildings match'}.` : 'No building with an accessible entrance matches.';
}

// A new stop on the current route; partway through a trip, re-routed from where you are
function addStopAndRoute(newStop) {
  insertStop(newStop);
  if (guide.active) prepareRerouteFromHere(newStop);
  renderStops();
  updateRoute(window.map);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('stop-building-search').addEventListener('input', (e) => showStopBuildings(e.target.value));
  document.getElementById('stop-building-matches').addEventListener('click', (e) => {
    const m = stopBuildings[Number(e.target.closest('[data-stop-building]')?.dataset.stopBuilding)];
    if (!m) return;
    const graph = currentGraph();
    const door = graph.entrances.find((en) => en.building === m.building);
    if (nearbyMarker) { nearbyMarker.remove(); nearbyMarker = null; }
    addStopAndRoute({ label: m.building, building: m.building, lonlat: graph.nodes[door.node] });
  });
  const select = document.getElementById('nearby-kind');
  select.innerHTML = Object.entries(NEARBY_KINDS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  // Changing what to find, or where from, searches again
  for (const id of ['nearby-kind', 'nearby-from']) {
    document.getElementById(id).addEventListener('change', (e) => {
      if (!routing) return;
      if (id === 'nearby-from') nearbyChosenBuilding = ['me', 'route'].includes(e.target.value) ? null : e.target.value;
      setResultsTitle();
      findNearby(window.map);
    });
  }
  // "More…" under the quick searches: every kind of thing that can be found, spelled out
  const more = document.getElementById('more-kinds'), moreButton = document.getElementById('chip-more');
  more.innerHTML = Object.entries(NEARBY_KINDS).map(([k, c]) => `<button type="button" class="chip" data-find="${k}">${c.label}</button>`).join('');
  const setMoreOpen = (open) => {
    more.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    moreButton.textContent = open ? 'Fewer' : 'More…';
  };
  moreButton.addEventListener('click', () => {
    setMoreOpen(more.hidden);
    if (!more.hidden) more.querySelector('button').focus();
  });
  // Quick searches under Where to?
  document.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-find]')?.dataset.find;
    if (!kind || !routing) return;
    setMoreOpen(false);
    openNearby(kind);
  });
  document.getElementById('results-back').addEventListener('click', () => {
    if (nearbyMarker) { nearbyMarker.remove(); nearbyMarker = null; }
    setView(nearbyReturn);
    clearWhereTo();
    if (nearbyReturn === 'walk') document.getElementById('guidance-repeat').focus();
    else if (nearbyReturn === 'route') document.getElementById('guidance-start-audio')?.focus();
    else document.getElementById('where-to').focus();
  });

  document.addEventListener('click', (e) => {
    const go = e.target.dataset?.nearbyGo, stop = e.target.dataset?.nearbyStop, show = e.target.dataset?.nearbyShow;
    if (go === undefined && stop === undefined && show === undefined) return;
    const result = nearbyResults[Number(go ?? stop ?? show)];
    if (!result) return;
    const map = window.map;
    if (show !== undefined) return showNearbyOnMap(map, result);
    if (nearbyMarker) { nearbyMarker.remove(); nearbyMarker = null; }
    const from = document.getElementById('route-from');
    const midTrip = guide.active; // in step-by-step mode: re-route from where you are now
    if (stop !== undefined) return addStopAndRoute({ label: result.label, phrase: result.phrase, building: result.building, lonlat: result.lonlat });
    // Directions there: from wherever the search was measured, or from here mid-trip
    if (midTrip) prepareRerouteFromHere();
    else if (nearbyFromYou) from.value = MY_LOCATION;
    else if (nearbyFromBuilding) {
      from.value = nearbyFromBuilding;
      routing.fromChosen = true;
    }
    if (result.building) {
      routing.place = null;
      document.getElementById('route-to').value = result.building;
    } else {
      setPlaceDestination({ label: result.label, phrase: result.phrase, lonlat: result.lonlat });
    }
    updateRoute(map);
  });
});
