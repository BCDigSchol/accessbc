// "Blue light": one button, always on screen, that finds the nearest blue-light emergency phone by walking
// distance from where you are and goes straight into walking directions to it, replacing any trip under way.
// In an emergency every second counts, so it skips the route preview and the in-development notice. If it
// can't find a route (no location, off campus), it says so and offers the BC Police phone number instead.

const BC_POLICE = { label: '617-552-4444', tel: '+16175524444' };
const STRAIGHT_LINE_LIMIT_M = 1000; // when no walking route works, still point out a phone this close

// Whether the trip is to a blue-light phone (from Blue light, Find nearby, or the map): the numbers to call are shown
const isBluelightTrip = () => !!routing?.place && (routing.place.emergency || /^Blue-light phone/.test(routing.place.label));

function emergencyCallLinks() {
  return `<p class="emergency-call"><a href="tel:${BC_POLICE.tel}">Call BC Police: ${BC_POLICE.label}</a>
    <a href="tel:911">Call 911</a></p>`;
}

// The emergency message box: a note over the map (in every view), announced at once and given focus.
function showEmergencyMessage(html, { focus = true } = {}) {
  const box = document.getElementById('emergency-message');
  document.getElementById('emergency-message-text').innerHTML = html;
  if (box.hidden) emergencyOpener = document.activeElement;
  box.hidden = false;
  if (focus) box.focus();
  if (guide.active) speak(box.querySelector('#emergency-message-text').textContent.trim());
}

let emergencyOpener = null; // focus goes back here when the message is closed

function hideEmergencyMessage({ returnFocus = false } = {}) {
  const box = document.getElementById('emergency-message');
  if (box.hidden) return;
  box.hidden = true;
  if (returnFocus && emergencyOpener && document.contains(emergencyOpener) && emergencyOpener.offsetParent) emergencyOpener.focus();
}

async function goToNearestBluelight() {
  if (!routing) return;
  const map = window.map;
  const { module } = routing;
  showEmergencyMessage(`<p>Finding the nearest blue-light emergency phone… If you can call, that’s faster:</p>${emergencyCallLinks()}`);

  let fix;
  try {
    fix = await currentFix();
  } catch {
    return showEmergencyMessage(`<p><strong>Your location isn’t available</strong>, so the nearest blue-light phone can’t be found.
      Blue-light phones are shown on the map as blue dots. In an emergency, call:</p>${emergencyCallLinks()}`);
  }
  const graph = currentGraph();
  const start = module.nearestNode(graph, fix.lonlat);
  // Phones reported not working are left out, unless every phone is
  const all = nearbyCandidates(graph, 'bluelights');
  const working = all.filter((c) => !isReportedBroken(c.feature));
  const candidates = working.length ? working : all;

  // Nearest by walking distance, honouring the route options; failing that, ignoring them
  let nearest = null;
  if (start.d <= MAX_START_DISTANCE_M) {
    const options = routeOptions();
    if (Number.isFinite(options.maxGrade)) await ensureGrades(graph);
    for (const cost of [edgeCost(graph, options), undefined]) {
      const distances = module.walkingDistances(graph, [start.node], cost);
      nearest = candidates
        .map((c) => ({ ...c, distance: distances[c.nodes[0]] + c.offset }))
        .filter((c) => Number.isFinite(c.distance))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest) break;
    }
  }
  if (!nearest) {
    // No walking route from here: say where the closest phone is in a straight line, if it's not far
    const here = module.proj(fix.lonlat);
    const closest = candidates
      .map((c) => ({ ...c, distance: module.dist(here, module.proj(c.lonlat)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (closest && closest.distance <= STRAIGHT_LINE_LIMIT_M) {
      showNearbyOnMap(map, closest);
      return showEmergencyMessage(`<p><strong>No mapped walking route from here</strong>, but the nearest blue-light phone
        (${escapeHtml(closest.label)}) is about ${feet(closest.distance)} away in a straight line,
        ${directionWords(lonlatBearing(fix.lonlat, closest.lonlat))}. It’s marked on the map. In an emergency, call:</p>${emergencyCallLinks()}`);
    }
    return showEmergencyMessage(`<p><strong>You seem to be away from campus</strong>, so there’s no blue-light phone nearby.
      In an emergency, call:</p>${emergencyCallLinks()}`);
  }

  // Straight into walking directions to it, from your location, with no stops
  if (nearbyMarker) { nearbyMarker.remove(); nearbyMarker = null; }
  routing.stops = [];
  renderStops();
  document.getElementById('route-from').value = MY_LOCATION;
  setPlaceDestination({ label: nearest.label, phrase: nearest.phrase, lonlat: nearest.lonlat, emergency: true });
  routing.autoStart = { follow: true, intro: `Emergency directions to the nearest blue-light phone, ${feet(nearest.distance)} away.` };
  hideEmergencyMessage();
  await updateRoute(map);
  if (!routing.current) {
    // The route couldn't be made after all (for example, the location changed): say so, with the numbers to call
    routing.autoStart = null;
    showEmergencyMessage(`<p><strong>Directions to the nearest blue-light phone couldn’t be found.</strong>
      It’s ${escapeHtml(nearest.phrase || nearest.label)}, about ${feet(nearest.distance)} walk. In an emergency, call:</p>${emergencyCallLinks()}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.emergency-button')) return;
    unlockAudio(); // speech and sounds need this button press to start on phones
    if (settings.clockFace) startCompass();
    goToNearestBluelight();
  });
  // "Directions here" on a blue-light phone on the map: walking directions to it, from your location
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-bluelight-directions]');
    if (!button || !routing) return;
    const lonlat = button.dataset.bluelightDirections.split(',').map(Number);
    const label = button.dataset.label;
    document.querySelectorAll('.maplibregl-popup').forEach((p) => p.remove());
    document.getElementById('route-from').value = MY_LOCATION;
    setPlaceDestination({ label, phrase: `the ${label[0].toLowerCase()}${label.slice(1)}`, lonlat });
    updateRoute(window.map);
    document.getElementById('route-title').focus();
  });
  const box = document.getElementById('emergency-message');
  document.getElementById('emergency-message-close').addEventListener('click', () => hideEmergencyMessage({ returnFocus: true }));
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideEmergencyMessage({ returnFocus: true }); });
});
