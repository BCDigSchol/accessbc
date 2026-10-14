// Orientation without the map, for students who are blind or have low vision:
// - which way the phone is facing, from its compass, so directions can be clock positions ("at your 2 o'clock")
// - "Face the right way": a tone, from the side to turn toward, until you face the way to go
// - "Where am I?": the nearest building, how you're doing on your route, and what's around you
// - what's around a building (its accessible entrances and elevators, and the nearest blue-light phone,
//   shuttle stop, and seating), for the building information dialog
// - cues along each step of a route: curb ramps, stairs you pass, and seating
// Distances to things around you are straight-line distances; directions use the compass when the phone has
// one, and compass points (north, northeast...) otherwise.

const orientation = { heading: null, at: 0, started: false, pointing: null, pointingSince: 0 };
const AROUND_RADIUS_M = 200;   // "what's around" looks this far
const CUE_OFF_ROUTE_M = 6;     // curb ramps and stairs this close to a step are mentioned
const CUE_SEATING_M = 12;
const CUE_SEATING_STEP_M = 75; // only mention seating on steps at least this long
const FACING_TOLERANCE_DEG = 15;

const normaliseDeg = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const lonlatBearing = (a, b) => {
  const [p, q] = [routing.module.proj(a), routing.module.proj(b)];
  return (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
};
const lonlatMetres = (a, b) => routing.module.dist(routing.module.proj(a), routing.module.proj(b));

// ---- Compass --------------------------------------------------------------------------------------

// Start listening to the compass. iPhones ask for permission first, so call this from a button press.
async function startCompass() {
  if (orientation.started) return true;
  if (!('DeviceOrientationEvent' in window)) return false;
  // iPhones (and some other browsers) need permission; only a clear "denied" stops us. Without readings,
  // facing() stays null and everything falls back to compass points.
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) === 'denied') return false;
    } catch { /* not from a button press; listen anyway */ }
  }
  // Compass readings are for the top of the phone; turned sideways, the screen's top is 90 degrees round
  const screenAngle = () => (screen.orientation ? screen.orientation.angle : Number(window.orientation) || 0);
  const set = (deg) => {
    orientation.heading = (((deg + screenAngle()) % 360) + 360) % 360;
    orientation.at = Date.now();
  };
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', (e) => { if (e.alpha !== null) set(360 - e.alpha); });
  } else {
    window.addEventListener('deviceorientation', (e) => {
      if (typeof e.webkitCompassHeading === 'number') set(e.webkitCompassHeading);
      else if (e.absolute && e.alpha !== null) set(360 - e.alpha);
    });
  }
  orientation.started = true;
  return true;
}

// The way the phone is facing (degrees clockwise from north), or null without a recent compass reading.
function facing() {
  return orientation.heading !== null && Date.now() - orientation.at < 3000 ? orientation.heading : null;
}

function clockHour(relativeDeg) {
  const hour = Math.round((((relativeDeg % 360) + 360) % 360) / 30) % 12;
  return hour === 0 ? 12 : hour;
}

// Words for a direction: "at your 2 o'clock" with the compass (and the clock-face setting on), else "to the
// northeast". Pass useCompass false for directions that aren't from where you are (e.g. around a building).
function directionWords(bearingDeg, useCompass = true) {
  const heading = useCompass && settings.clockFace ? facing() : null;
  if (heading === null) return `to the ${routing.guidance.compass(bearingDeg)}`;
  const hour = clockHour(bearingDeg - heading);
  return hour === 12 ? 'straight ahead, at your 12 o’clock' : `at your ${hour} o’clock`;
}

// Say something to everyone: screen readers through the live region, and aloud if reading aloud is on.
function tell(text) {
  announce(text);
  speak(text);
}

// ---- Tones ----------------------------------------------------------------------------------------

let audioContext = null;
// Phones only allow sound after a button press: call this from one so later tones (on GPS updates) play.
function unlockAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch { /* no audio */ }
}

// A short tone; pan is -1 (left ear) to 1 (right ear).
function tone(frequency, { pan = 0, ms = 90, volume = 0.15 } = {}) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const t = audioContext.currentTime;
    const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    osc.connect(gain);
    if (audioContext.createStereoPanner) {
      const panner = audioContext.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner).connect(audioContext.destination);
    } else {
      gain.connect(audioContext.destination);
    }
    osc.start(t);
    osc.stop(t + ms / 1000);
  } catch { /* no audio */ }
}

// ---- Face the right way ---------------------------------------------------------------------------

// Guide the student to face a direction: a tick in the ear on the side to turn toward, quicker as they get
// close, then two rising tones and "Facing the right way". Spoken hints say which way to turn, now and then.
// report(text) shows and announces progress.
async function startPointing(getTarget, report) {
  stopPointing();
  if (!(await startCompass())) {
    report('Your phone’s compass isn’t available. Check that motion and orientation access is allowed for this site.');
    return;
  }
  report('Hold your phone flat in front of you, top pointing ahead, and turn slowly.');
  orientation.pointingSince = Date.now();
  let lastSaid = Date.now() - 1000, lastHour = null, onTargetSince = null; // first spoken hint after 1.5 s
  const next = (ms) => { orientation.pointing = setTimeout(tick, ms); };
  const tick = () => {
    const heading = facing();
    if (heading === null) {
      if (Date.now() - orientation.pointingSince > 4000) {
        stopPointing();
        report('No compass readings from this device, so it can’t tell which way you’re facing.');
        return;
      }
      return next(400);
    }
    if (Date.now() - orientation.pointingSince > 45000) {
      stopPointing();
      report('Stopped. Choose Face the right way to try again.');
      return;
    }
    const delta = normaliseDeg(getTarget() - heading);
    if (Math.abs(delta) <= FACING_TOLERANCE_DEG) {
      onTargetSince ??= Date.now();
      tone(880, { ms: 70 });
      if (Date.now() - onTargetSince > 700) {
        stopPointing();
        tone(1320, { ms: 160 });
        if (settings.vibrate && navigator.vibrate) navigator.vibrate([60, 60, 60]);
        report('Facing the right way.');
        return;
      }
      return next(250);
    }
    onTargetSince = null;
    tone(440, { pan: delta > 0 ? 0.9 : -0.9, ms: 60 });
    const hour = clockHour(delta);
    if (hour !== lastHour && Date.now() - lastSaid > 2500) {
      lastSaid = Date.now();
      lastHour = hour;
      report(`Turn ${delta > 0 ? 'right' : 'left'}: the way to go is at your ${hour} o’clock.`);
    }
    next(Math.max(180, Math.min(900, Math.abs(delta) * 6)));
  };
  tick();
}

function stopPointing() {
  clearTimeout(orientation.pointing);
  orientation.pointing = null;
}

// ---- What's around --------------------------------------------------------------------------------

// Which building an entrance or elevator point belongs to: its Building field, else the building it's in or beside.
function buildingOf(feature) {
  const named = (feature.properties.Building || '').trim();
  if (named) return named;
  const near = routing.module.nearestBuilding(currentGraph().buildings, routing.module.proj(feature.geometry.coordinates));
  return near.d <= 5 ? (near.name || '').trim() : '';
}

const working = (feature) => !feature.properties.Status || feature.properties.Status === 'Working';

function shuttleDetails(p) {
  const routes = [['Express', 'Express'], ['All_Stop', 'All Stop'], ['Commonwealth', 'Commonwealth'], ['Newton', 'Newton']]
    .filter(([k]) => p[k] === 'Yes').map(([, name]) => name);
  return [routes.length ? `${routes.join(', ')} routes` : '', p.Sheltered === 'Yes' ? 'sheltered' : ''].filter(Boolean).join('; ');
}

// The nearest of each kind of thing around a point: [{label, lonlat, metres, bearing}], nearest first.
function thingsAround(lonlat, { skipBuilding = null } = {}) {
  const points = routePoints || {};
  const near = (features) => (features || [])
    .map((f) => ({ f, metres: lonlatMetres(lonlat, f.geometry.coordinates) }))
    .filter((x) => x.metres <= AROUND_RADIUS_M)
    .sort((a, b) => a.metres - b.metres);
  const items = [];
  const add = (x, label) => items.push({ label, lonlat: x.f.geometry.coordinates, metres: x.metres, bearing: lonlatBearing(lonlat, x.f.geometry.coordinates) });

  // The two nearest accessible entrances of different buildings
  const seen = new Set(skipBuilding ? [skipBuilding] : []);
  for (const x of near(points.entrances?.features)) {
    const building = buildingOf(x.f);
    if (!building || seen.has(building)) continue;
    seen.add(building);
    add(x, `Accessible entrance of ${building}${working(x.f) ? '' : ' (reported not working)'}`);
    if (seen.size >= (skipBuilding ? 3 : 2)) break;
  }
  const elevator = near(points.elevators?.features).find((x) => buildingOf(x.f) !== skipBuilding);
  if (elevator) add(elevator, `Elevator${buildingOf(elevator.f) ? ` in ${buildingOf(elevator.f)}` : ''}${working(elevator.f) ? '' : ' (reported not working)'}`);
  const phone = near(points.bluelights?.features)[0];
  if (phone) add(phone, 'Blue-light emergency phone');
  const shuttle = near(points.shuttlestops?.features)[0];
  if (shuttle) {
    const details = shuttleDetails(shuttle.f.properties);
    add(shuttle, `Shuttle stop${details ? ` (${details})` : ''}`);
  }
  const seat = near(points.reststop?.features)[0];
  if (seat) {
    const kind = seat.f.properties['Select the type of rest point'] === 'Chairs with Table' ? 'Outdoor chairs and table' : 'Outdoor bench';
    add(seat, `${kind}${seat.f.properties.Shaded_First === 'Yes' ? ' (shaded)' : ''}`);
  }
  return items.sort((a, b) => a.metres - b.metres);
}

const aroundItemText = (item, useCompass = true) =>
  item.metres < 5 ? `${item.label}: right here.` : `${item.label}: about ${feet(item.metres)}, ${directionWords(item.bearing, useCompass)}.`;

// The building information dialog's "Getting in and around" section.
function buildingSurroundingsHtml(name) {
  if (!routing || !routePoints) return '';
  const building = currentGraph().buildings.find((b) => (b.name || '').trim() === name);
  if (!building) return '';
  const centre = routing.module.unproj([(building.bbox[0] + building.bbox[2]) / 2, (building.bbox[1] + building.bbox[3]) / 2]);
  const sideOf = (lonlat) => `${routing.guidance.compass(lonlatBearing(centre, lonlat))} side`;
  const own = (features) => (routePoints[features]?.features || []).filter((f) => buildingOf(f) === name);

  const entrances = own('entrances').map((f) => `<li>Accessible entrance on the ${sideOf(f.geometry.coordinates)}${working(f) ? '' : ' (reported not working)'}</li>`);
  const elevators = own('elevators').map((f) => `<li>Elevator, toward the ${sideOf(f.geometry.coordinates)}${working(f) ? '' : ' (reported not working)'}</li>`);
  const around = thingsAround(centre, { skipBuilding: name }).filter((item) => !item.label.startsWith('Accessible entrance'))
    .map((item) => `<li>${escapeHtml(item.label)}: about ${feet(item.metres)} ${directionWords(item.bearing, false)}</li>`);
  const access = [...new Set(entrances), ...new Set(elevators)];
  return `
    <h3>Getting in</h3>
    ${access.length ? `<ul class="around-list">${access.join('')}</ul>` : '<p>No accessible entrance is mapped for this building.</p>'}
    ${around.length ? `<h3>Nearby</h3><ul class="around-list">${around.join('')}</ul><p class="route-note">Straight-line distances from the middle of the building.</p>` : ''}`;
}

// ---- Where am I? ----------------------------------------------------------------------------------

function currentFix() {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lonlat: [p.coords.longitude, p.coords.latitude], accuracy: p.coords.accuracy }),
    reject,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  ));
}

// Nearest point on any building outline, with the building's name (lon/lat).
function nearestBuildingEdge(lonlat) {
  const { module } = routing;
  const p = module.proj(lonlat);
  let best = { d: Infinity };
  for (const b of currentGraph().buildings) {
    if (!(b.name || '').trim()) continue;
    if (p[0] < b.bbox[0] - AROUND_RADIUS_M || p[0] > b.bbox[2] + AROUND_RADIUS_M || p[1] < b.bbox[1] - AROUND_RADIUS_M || p[1] > b.bbox[3] + AROUND_RADIUS_M) continue;
    for (const ring of b.rings)
      for (let i = 1; i < ring.length; i++) {
        const r = module.nearestOnSegment(p, ring[i - 1], ring[i]);
        if (r.d < best.d) best = { d: r.d, name: b.name.trim(), lonlat: module.unproj(r.point) };
      }
  }
  return best;
}

// Where you are, in words: [sentences to say first, then the list of what's around]
async function describeWhereIAm() {
  const { module } = routing;
  let fix;
  try {
    fix = await currentFix();
  } catch {
    return { said: ['Your location isn’t available. Check that location access is allowed for this site and turned on for your browser.'], around: [] };
  }
  if (settings.clockFace) await startCompass();
  const said = [];
  const p = module.proj(fix.lonlat);
  const inside = module.nearestBuilding(currentGraph().buildings, p);
  const edge = nearestBuildingEdge(fix.lonlat);
  if (inside.d === 0 && inside.name) said.push(`You’re in or right beside ${inside.name.trim()}.`);
  else if (edge.d <= AROUND_RADIUS_M) said.push(`You’re about ${feet(edge.d)} from ${edge.name}, ${directionWords(lonlatBearing(fix.lonlat, edge.lonlat))}.`);
  else said.push('You’re not near any mapped campus building.');
  if (fix.accuracy > 20) said.push(`Your location is only accurate to about ${feet(fix.accuracy)}.`);

  if (guide.active && guide.line) {
    const { off, along, point } = locateOnRoute(p);
    if (off <= Math.max(15, fix.accuracy)) said.push('You’re on your route.');
    else said.push(`Your route is about ${feet(off)} away, ${directionWords(lonlatBearing(fix.lonlat, module.unproj(point)))}.`);
    const nextIndex = guide.starts.findIndex((s) => s > along + 2);
    if (nextIndex > 0) said.push(`In about ${feet(guide.starts[nextIndex] - along)}: ${guide.steps[nextIndex].text}`);
  }
  return { said, around: thingsAround(fix.lonlat) };
}

// ---- Cues along a step ----------------------------------------------------------------------------

// Distance along a polyline (metres) to the point nearest p, and how far p is from it, with the side.
function alongLine(line, p) {
  const { nearestOnSegment, dist } = routing.module;
  let best = { off: Infinity }, travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], len = dist(a, b);
    const r = nearestOnSegment(p, a, b);
    if (r.d < best.off) {
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      best = { off: r.d, along: travelled + r.t * len, side: cross > 0 ? 'left' : 'right' };
    }
    travelled += len;
  }
  return best;
}

const listFeet = (distances) => distances.map((d) => feet(d)).join(distances.length > 2 ? ', ' : ' and ');

// Things worth knowing on an outdoor step, as short sentences.
function stepCues(step) {
  if (step.type !== 'outdoor' || !step.length || step.coordinates.length < 2 || !routePoints) return [];
  const { module } = routing;
  const line = step.coordinates.map(module.proj);
  const onStep = (features, maxOff) => (features || [])
    .map((f) => ({ f, ...alongLine(line, module.proj(f.geometry.coordinates)) }))
    .filter((x) => x.off <= maxOff && x.along > 2 && x.along < step.length - 2)
    .sort((a, b) => a.along - b.along);
  const cues = [];

  // Curb ramps, merging ones within 10 m of each other (the two sides of one crossing)
  const ramps = [];
  for (const x of onStep(routePoints.curbcuts?.features, CUE_OFF_ROUTE_M)) if (!ramps.length || x.along - ramps.at(-1) > 10) ramps.push(x.along);
  if (ramps.length) cues.push(`Curb ${ramps.length === 1 ? 'ramp' : 'ramps'} about ${listFeet(ramps.slice(0, 3))} ahead, often where a street or driveway is crossed.`);

  // Stairs that branch off the route (not ones the route takes)
  const stairs = (routing.data.footpaths || []).filter((f) => f.properties.highway === 'steps' && f.geometry.type === 'LineString');
  const stairEnds = stairs.flatMap((f) => [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)].map((c) => ({ geometry: { coordinates: c } })));
  const branch = onStep(stairEnds, CUE_OFF_ROUTE_M)[0];
  if (branch) cues.push(`Stairs branch off on your ${branch.side} about ${feet(branch.along)} ahead. Stay on the level path.`);

  // Seating only on longer stretches, where a place to rest is worth knowing about
  const seat = step.length >= CUE_SEATING_STEP_M && onStep(routePoints.reststop?.features, CUE_SEATING_M)[0];
  if (seat) cues.push(`Outdoor seating on your ${seat.side} about ${feet(seat.along)} ahead.`);
  return cues;
}

// ---- Controls -------------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // "Where am I?", in the directions panel and in step-by-step mode
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('.where-am-i') || !routing) return;
    const inGuide = guide.active;
    const out = inGuide ? document.getElementById('guidance-status') : document.getElementById('where-result');
    out.innerHTML = '<p>Finding your location…</p>';
    const { said, around } = await describeWhereIAm();
    const list = around.map((item) => `<li>${escapeHtml(aroundItemText(item))}</li>`).join('');
    out.innerHTML = `<p>${said.map(escapeHtml).join(' ')}</p>${list ? `<p class="around-heading">Around you:</p><ul class="around-list">${list}</ul>` : ''}`;
    // Say the summary and the nearest two things; the rest is in the list
    tell([...said, ...around.slice(0, 2).map((item) => aroundItemText(item))].join(' '));
  });

  // "Face the right way" in step-by-step mode: toward the current step, or back to the route when off it
  document.getElementById('guidance-orient').addEventListener('click', () => {
    if (orientation.pointing) {
      stopPointing();
      guidanceStatus('');
      return;
    }
    const target = () => (guide.backToRoute !== null && guide.backToRoute !== undefined ? guide.backToRoute : guide.steps[guide.index].heading);
    startPointing(target, (text) => {
      guidanceStatus(escapeHtml(text));
      tell(text);
    });
  });
});
