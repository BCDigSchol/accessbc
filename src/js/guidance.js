// Step-by-step directions: one instruction at a time, with the map following along (centred on the step,
// turned to face the way you walk, and tilted into 3D, per the accessibility settings). Steps can be read
// aloud, and with "Follow my location" they advance on their own as you walk.

const guide = {
  active: false,
  steps: [],
  index: 0,
  starts: [],         // distance from the route start (m) at which each step begins
  line: null,         // the whole route in metres, for matching GPS fixes to it
  watch: null,        // geolocation watch id while following
  marker: null,       // "you are here" marker while following
  offRouteFixes: 0,
  announcedApproach: -1,
  backToRoute: null,  // while off the route: the bearing back to it, for "Face the right way"
  lastReroute: 0,     // when the route was last found again automatically (ms)
};

const REROUTE_AFTER_FIXES = 3;  // location readings off the route in a row before finding a new route
const REROUTE_GAP_MS = 20000;   // at most one automatic re-route this often, so a bad GPS patch can't loop

// ---- Hands-free: sounds, vibration, and keeping the screen on ------------------------------------------

// Short sounds, so not everything has to be a sentence. A new step's tone comes from the side of the turn.
const SOUND_CUES = {
  step: (step) => tone(660, { ms: 90, pan: step.kind === 'turn' ? Math.sign(step.turn) * 0.8 : 0 }),
  soon: () => { tone(880, { ms: 70 }); setTimeout(() => tone(880, { ms: 70 }), 140); },
  offRoute: () => { tone(392, { ms: 200 }); setTimeout(() => tone(262, { ms: 260 }), 230); },
  arrive: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, { ms: 160 }), i * 170)),
};
function soundCue(name, step) {
  if (settings.soundCues) SOUND_CUES[name](step);
}

// Vibration you can tell apart in a pocket: two pulses for a left turn, three for a right, a long-short-long
// at a stop or the destination, one long buzz for leaving the route. (Android; iPhones can't vibrate from web pages.)
function vibrationFor(step) {
  if (step.kind === 'arrive' || step.kind === 'stop') return [300, 100, 100, 100, 300];
  if (step.kind === 'turn') return step.turn < 0 ? [120, 120, 120] : [120, 120, 120, 120, 120];
  return [80];
}
function buzz(pattern) {
  if (settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
}

// Keep the screen on during step-by-step directions: phones stop location updates and speech when they lock.
let wakeLock = null;
async function keepScreenOn() {
  if (!('wakeLock' in navigator) || !guide.active || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* refused, e.g. in battery saver */ }
}
function letScreenSleep() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
// The browser drops the lock when the page is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepScreenOn();
});

// Speak text if reading aloud is on. Uses the browser's built-in speech; nothing is sent anywhere.
function speak(text) {
  // Screen reader users hear the same text through the page's live regions, so don't say it twice
  if (!settings.readAloud || settings.screenReader || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  // Say units in full ("ft" is read as letters by some voices)
  const words = text.replace(/(\d) ft\b/g, '$1 feet').replace(/(\d) mi\b/g, '$1 miles');
  const utterance = new SpeechSynthesisUtterance(words);
  utterance.rate = Number(settings.speechRate) || 1;
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

// The "Speak directions" button in step-by-step mode shows whether reading aloud is on.
function syncAudioButton() {
  const button = document.getElementById('guidance-audio');
  button.hidden = !('speechSynthesis' in window) || !!settings.screenReader;
  button.setAttribute('aria-pressed', String(!!settings.readAloud));
}

// The "Large view" button shows whether the large step-by-step view is on.
function syncBigButton() {
  document.getElementById('guidance-big').setAttribute('aria-pressed', String(!!settings.bigSteps));
}

function guidanceStatus(html) {
  document.getElementById('guidance-status').innerHTML = html;
}

// step: the step to show first (when a trip is restored from the page address). intro: said before the first step
// (e.g. "New route."). keepFocus: leave keyboard focus where it is (after an automatic re-route mid-walk).
async function startGuidance(map, { follow = false, step = 0, intro = '', keepFocus = false } = {}) {
  const current = routing.current;
  if (!current) return;
  const { guidance, module } = routing;
  guide.steps = guidance.buildSteps(current.graph, current.route, current);
  guide.steps.forEach((step) => { step.cues = stepCues(step); });
  guide.starts = guide.steps.reduce((acc, step, i) => (acc.push(i ? acc[i - 1] + guide.steps[i - 1].length : 0), acc), []);
  guide.line = guide.steps.flatMap((s) => s.coordinates).map(module.proj);
  guide.active = true;
  unlockAudio(); // sounds need a button press to start on phones; startGuidance runs from one
  keepScreenOn();
  guide.announcedApproach = -1;
  guide.offRouteFixes = 0;
  guide.backToRoute = null;

  const panel = document.getElementById('directions-panel');
  panel.classList.add('guiding');
  document.body.classList.add('guiding');
  document.getElementById('directions-title').textContent = 'Step-by-step directions';
  document.getElementById('guidance').hidden = false;
  guidanceStatus('');
  syncAudioButton();
  syncBigButton();
  setRouteDimmed(map, true);
  if (follow) startFollowing(map);
  await showStep(map, step, intro);
  if (!keepFocus) document.getElementById('guidance-next').focus();
}

function stopGuidance(map) {
  if (!guide.active) return;
  guide.active = false;
  letScreenSleep();
  stopFollowing();
  stopPointing();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const panel = document.getElementById('directions-panel');
  panel.classList.remove('guiding', 'adding-stop');
  document.body.classList.remove('guiding');
  document.getElementById('directions-title').textContent = 'Accessible directions';
  document.getElementById('guidance').hidden = true;
  map.getSource('route-step').setData({ type: 'FeatureCollection', features: [] });
  setRouteDimmed(map, false);
  moveMap(map, 'easeTo', { pitch: 0, bearing: 0 });
  saveTripToUrl();
}

function setRouteDimmed(map, dimmed) {
  for (const id of ['route-outdoor', 'route-indoor', 'route-stairs']) map.setPaintProperty(id, 'line-opacity', dimmed ? 0.35 : 1);
}

// Slope note for a step, from the terrain data (outdoor steps only).
async function stepSlopeNote(step) {
  if (step.type === 'stairs') return 'Stairs.';
  if (step.type === 'indoor') return 'Indoors.';
  if (!step.length || step.length < 10) return ''; // too short to measure a slope
  try {
    const profile = await routing.elevation.profile(routing.terrain, step.coordinates);
    if (!profile) return '';
    if (profile.unreliableLength >= 3 && step.length - profile.unreliableLength < 10) {
      return 'The elevation data here can’t be trusted (it may be a bridge or stairs). Check this part on site.';
    }
    const grade = profile.maxGrade, pct = (Math.abs(grade) * 100).toFixed(1);
    const dir = Math.abs(grade) < 0.005 ? '' : grade > 0 ? ' uphill' : ' downhill';
    const cls = routing.elevation.gradeClass(grade);
    if (cls === 'very-steep') return `Steep: up to ${pct}%${dir}, steeper than 1:12.`;
    if (cls === 'steep') return `Steep: up to ${pct}%${dir}, steeper than 1:20.`;
    return `Gentle: up to ${pct}%${dir}.`;
  } catch {
    return '';
  }
}

async function showStep(map, index, intro = '') {
  guide.index = Math.max(0, Math.min(guide.steps.length - 1, index));
  const step = guide.steps[guide.index];
  const total = guide.steps.length;
  document.getElementById('guidance-progress').textContent = `Step ${guide.index + 1} of ${total}`;
  document.getElementById('guidance-instruction').textContent = step.text;
  // Setting off (at the start, after a stop, out of a building): which way that is from where you face
  const hint = ['depart', 'stop', 'exit'].includes(step.kind) && facing() !== null && settings.clockFace
    ? `The way to go is ${directionWords(step.heading)}.` : '';
  const cues = [hint, ...(step.cues || [])].filter(Boolean);
  document.getElementById('guidance-cues').innerHTML = cues.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
  document.getElementById('guidance-prev').disabled = guide.index === 0;
  document.getElementById('guidance-next').disabled = guide.index === total - 1;
  document.getElementById('guidance-detail').textContent = '';
  stepSlopeNote(step).then((note) => {
    if (guide.steps[guide.index] === step) document.getElementById('guidance-detail').textContent = note;
  });

  // Highlight this step and mark where it starts
  map.getSource('route-step').setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: step.coordinates.length > 1 ? step.coordinates : [step.start, step.start] } },
      { type: 'Feature', properties: { kind: 'point' }, geometry: { type: 'Point', coordinates: step.start } },
    ],
  });

  if (!guide.watch) frameStep(map, step);
  speak([intro, `Step ${guide.index + 1}. ${step.text}`, ...cues].filter(Boolean).join(' '));
  saveTripToUrl();
  soundCue(step.kind === 'arrive' || step.kind === 'stop' ? 'arrive' : 'step', step);
  buzz(vibrationFor(step));
}

// Camera for a step: fit it, facing the direction of travel if heading-up is on, tilted if 3D is on.
function frameStep(map, step) {
  const bearing = settings.headingUp ? step.heading : 0;
  const pitch = settings.guidance3D ? 50 : 0;
  const coords = step.coordinates.length > 1 ? step.coordinates : [step.start, step.start];
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  const camera = map.cameraForBounds(bounds, { bearing, padding: unobstructedPadding(map), maxZoom: 19 });
  const zoom = Math.max(16.5, Math.min(19, camera ? camera.zoom : 18.5));
  moveMap(map, 'easeTo', { center: camera ? camera.center : step.start, zoom, bearing, pitch, duration: 800 });
}

// ---- Following the student's location -------------------------------------------------------------

function startFollowing(map) {
  if (guide.watch || !('geolocation' in navigator)) return;
  const button = document.getElementById('guidance-follow');
  button.setAttribute('aria-pressed', 'true');
  button.textContent = 'Stop following my location';
  guidanceStatus('Finding your location…');
  guide.watch = navigator.geolocation.watchPosition(
    (position) => onPosition(map, position),
    (error) => {
      // Refused: stop. Lost for a moment (no GPS signal, a timeout): keep following; it often comes back.
      if (error.code === error.PERMISSION_DENIED) {
        guidanceStatus('Location access isn’t allowed, so Access BC can’t follow you. Allow it for this site, or use Next and Back.');
        stopFollowing();
      } else {
        guidanceStatus('Your location is unavailable for the moment. Keep going, or use Next and Back.');
      }
    },
    { enableHighAccuracy: true, maximumAge: 2000 }
  );
  saveTripToUrl();
}

function stopFollowing() {
  if (guide.watch !== null) navigator.geolocation.clearWatch(guide.watch);
  guide.watch = null;
  if (guide.marker) guide.marker.remove();
  guide.marker = null;
  const button = document.getElementById('guidance-follow');
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'Follow my location';
  saveTripToUrl();
}

// Nearest point on the route to a position: distance along the route and distance off it (metres).
function locateOnRoute(p) {
  const { nearestOnSegment, dist } = routing.module;
  let best = { off: Infinity, along: 0 }, travelled = 0;
  for (let i = 1; i < guide.line.length; i++) {
    const a = guide.line[i - 1], b = guide.line[i], len = dist(a, b);
    const r = nearestOnSegment(p, a, b);
    if (r.d < best.off) best = { off: r.d, along: travelled + r.t * len, point: r.point };
    travelled += len;
  }
  return best;
}

function onPosition(map, position) {
  const { latitude, longitude, accuracy } = position.coords;
  const here = [longitude, latitude];
  if (!guide.marker) {
    const dot = document.createElement('div');
    dot.className = 'you-are-here';
    dot.setAttribute('aria-hidden', 'true');
    guide.marker = new maplibregl.Marker({ element: dot }).setLngLat(here).addTo(map);
  } else {
    guide.marker.setLngLat(here);
  }
  if (accuracy > 50) {
    guidanceStatus(`Location is approximate (within ${Math.round(accuracy * 3.28084)} feet). Use Next and Back if steps don’t advance.`);
    return;
  }

  const { off, along } = locateOnRoute(routing.module.proj(here));
  const step = guide.steps[guide.index];
  moveMap(map, 'easeTo', { center: here, zoom: 18.5, bearing: settings.headingUp ? step.heading : 0, pitch: settings.guidance3D ? 50 : 0, duration: 600 });

  // Off the route for several fixes in a row: find a new route from here (like other map apps), or if that's
  // off or not possible, say which way the route is and offer to re-route.
  if (off > Math.max(25, accuracy * 1.5)) {
    if (++guide.offRouteFixes >= REROUTE_AFTER_FIXES && settings.autoReroute && Date.now() - guide.lastReroute > REROUTE_GAP_MS
      && routing.module.nearestNode(routing.current.graph, here).d <= MAX_START_DISTANCE_M) {
      guide.lastReroute = Date.now();
      soundCue('offRoute');
      buzz([500]);
      speak('Off route. Finding a new route from here.');
      guidanceStatus('You left the route. Finding a new route from here…');
      rerouteFromHere(map, { automatic: true });
      return;
    }
    if (guide.offRouteFixes >= REROUTE_AFTER_FIXES) {
      // Say which way the route is, so you can head back to it (or let "Face the right way" turn you to it)
      const back = locateOnRoute(routing.module.proj(here)).point;
      guide.backToRoute = lonlatBearing(here, routing.module.unproj(back));
      const said = `You seem to be off the route. It’s about ${feet(off)} away, ${directionWords(guide.backToRoute)}.`;
      if (guide.offRouteFixes === 3 || guide.offRouteFixes % 10 === 0) {
        soundCue('offRoute');
        buzz([500]);
        speak(said);
      }
      guidanceStatus(`${escapeHtml(said)} <button type="button" id="guidance-reroute">Re-route from here</button>`);
    }
    return;
  }
  guide.offRouteFixes = 0;
  guide.backToRoute = null;

  // Advance (never go back automatically) once past the start of a later step.
  let next = guide.index;
  while (next + 1 < guide.steps.length && along >= guide.starts[next + 1] - 4) next++;
  if (next !== guide.index) {
    guidanceStatus('');
    showStep(map, next);
    return;
  }
  // A heads-up shortly before the next step.
  const toNext = guide.starts[guide.index + 1] - along;
  if (guide.index + 1 < guide.steps.length && toNext < 20 && guide.announcedApproach !== guide.index) {
    guide.announcedApproach = guide.index;
    const upcoming = guide.steps[guide.index + 1].text;
    guidanceStatus(`In about ${Math.max(5, Math.round((toNext * 3.28084) / 5) * 5)} feet: ${upcoming}`);
    soundCue('soon');
    buzz(vibrationFor(guide.steps[guide.index + 1]));
    speak(`Soon: ${upcoming}`);
  } else if (step.type === 'indoor' && guide.announcedApproach !== guide.index) {
    guidanceStatus('Location is less reliable indoors. Use Next when you reach the end of this step.');
  }
}

// Partway through a trip, before changing it: drop the stops already passed, start the new route from where
// you are (your GPS position if following, else the start of the current step), and resume guidance after.
// A stop just added that turns out to be behind you becomes the next stop.
// Find a new route from here and carry on with step-by-step directions, keeping the stops not yet reached.
function rerouteFromHere(map, { automatic = false } = {}) {
  prepareRerouteFromHere();
  if (automatic) Object.assign(routing.autoStart, { intro: 'New route.', keepFocus: true });
  updateRoute(map);
}

function prepareRerouteFromHere(newStop) {
  const chosen = routing.stops.filter((st) => st.building || st.lonlat);
  const reached = guide.steps.slice(0, guide.index + 1).filter((st) => st.kind === 'stop').length;
  const passed = new Set(chosen.filter((st) => st !== newStop).slice(0, reached));
  routing.stops = routing.stops.filter((st) => !passed.has(st));
  if (newStop && !routing.stops.includes(newStop)) routing.stops.unshift(newStop);
  const following = !!guide.watch;
  if (following) document.getElementById('route-from').value = MY_LOCATION;
  else setPlaceStart({ label: 'Where you are now', lonlat: guide.steps[guide.index].start });
  routing.autoStart = { follow: following };
}

// ---- Controls ----------------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const card = document.getElementById('guidance');
  const go = (delta) => { if (guide.active) showStep(window.map, guide.index + delta); };

  document.addEventListener('click', (e) => {
    if (e.target.id === 'guidance-start') startGuidance(window.map);
    // Audio guidance: steps read aloud, advancing on their own as you walk
    if (e.target.closest('#guidance-start-audio')) {
      if (settings.clockFace) startCompass(); // asks for compass access on iPhones, which needs this button press
      if (!settings.screenReader) settings.readAloud = true;
      saveSettings();
      startGuidance(window.map, { follow: true });
    }
    if (e.target.id === 'guidance-reroute') rerouteFromHere(window.map);
  });
  document.getElementById('guidance-prev').addEventListener('click', () => go(-1));
  document.getElementById('guidance-next').addEventListener('click', () => go(1));
  document.getElementById('guidance-audio').addEventListener('click', () => {
    settings.readAloud = !settings.readAloud;
    saveSettings();
    syncAudioButton();
    if (settings.readAloud) speak(guide.steps[guide.index].text);
    else window.speechSynthesis.cancel();
  });
  document.getElementById('guidance-big').addEventListener('click', () => {
    settings.bigSteps = !settings.bigSteps;
    saveSettings();
    syncBigButton();
  });
  document.getElementById('guidance-repeat').addEventListener('click', () => {
    const step = guide.steps[guide.index];
    const live = document.getElementById('guidance-instruction');
    live.textContent = '';
    setTimeout(() => { live.textContent = step.text; }, 50); // re-announce to screen readers
    unlockAudio(); // after a reload, sound only starts once you press something
    if (settings.readAloud) speak(step.text);
  });
  document.getElementById('guidance-follow').addEventListener('click', () => {
    if (guide.watch) {
      stopFollowing();
      guidanceStatus('');
      frameStep(window.map, guide.steps[guide.index]);
    } else {
      startFollowing(window.map);
    }
  });
  // Add a stop mid-trip: show "Find nearby", searching along the route
  document.getElementById('guidance-add-stop').addEventListener('click', () => {
    const panel = document.getElementById('directions-panel');
    const adding = panel.classList.toggle('adding-stop');
    if (!adding) return;
    const nearby = document.querySelector('.nearby');
    nearby.open = true;
    document.getElementById('nearby-from').value = 'route';
    document.getElementById('nearby-kind').focus();
  });
  document.getElementById('guidance-exit').addEventListener('click', () => {
    stopGuidance(window.map);
    document.getElementById('guidance-start')?.focus();
  });

  // Arrow keys and swipes move between steps.
  card.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  let touchX = null;
  card.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    touchX = null;
  });
});
