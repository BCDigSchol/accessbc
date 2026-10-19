// Simulated walks: live walking directions tested on the move. Loads the site in a real browser, starts walking
// directions, and feeds the browser GPS fixes along the route (with a few metres of drift), as a phone would while
// someone walks. Checks what the student would hear and see:
//   - a normal walk: steps move on in order, never backwards; heads-ups before turns; arrival
//   - a wrong turn: off the route for a few fixes, a new route is found from there, and it gets you there
//   - poor signal: a run of very inaccurate fixes and a gap with none don't trigger re-routing or lose your place
//   - a shuttle ride: riding (on roads, well away from walking paths) is never "off route"; getting off is a step
//
// Usage (from this folder): npm run walks   (the same setup as npm run check); npm run walks -- shuttle runs one walk
// Exits non-zero if a walk goes wrong.
import { startServer, launchBrowser, seedStorage, appReady } from './harness.mjs';

const PORT = 8798;
const BASE = `http://localhost:${PORT}/`;
const FIX_MS = 150;       // between GPS fixes (real phones are about one a second; faster here, same logic)
const STEP_M = 5;         // metres walked between fixes
const RIDE_STEP_M = 30;   // and ridden
const DRIFT_M = 3;        // GPS drift
const problems = [];
const only = process.argv[2]; // a walk's name (normal, wrong turn, poor signal, shuttle), to run just that one
const run = (name) => !only || name.startsWith(only);

function expect(ok, walk, message) {
  if (!ok) problems.push(`[${walk}] ${message}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${walk}: ${message}`);
}

// Repeatable "random" drift, so a failing walk fails the same way every time
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Flat metres around the campus (as in src/js/routing/network.mjs)
const LON0 = -71.175, LAT0 = 42.335, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110540;
const toXY = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const toLonLat = ([x, y]) => [x / KX + LON0, y / KY + LAT0];

// Points every `spacing` metres along a line of [lon, lat], each moved by up to `drift` metres, and all of them
// `offset` metres to the left of it
function walkAlong(coords, spacing = STEP_M, drift = DRIFT_M, offset = 0) {
  const xy = coords.map(toXY), out = [];
  for (let i = 1; i < xy.length; i++) {
    const [a, b] = [xy[i - 1], xy[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d < len; d += spacing) {
      const t = d / len, left = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      out.push(toLonLat([a[0] + t * (b[0] - a[0]) + left[0] * offset + (random() - 0.5) * 2 * drift, a[1] + t * (b[1] - a[1]) + left[1] * offset + (random() - 0.5) * 2 * drift]));
    }
  }
  out.push(coords.at(-1));
  return out;
}

async function openWalk(browser, { time, start = [-71.1695, 42.3357] } = {}) {
  // A small window: the map is redrawn at every fix, in software on machines without a graphics card
  const context = await browser.newContext({ viewport: { width: 480, height: 420 }, geolocation: { longitude: start[0], latitude: start[1], accuracy: 8 }, permissions: ['geolocation'], timezoneId: 'America/New_York' });
  await seedStorage(context, { clockFace: false, soundCues: false });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (err) => problems.push(`[page error] ${err.message}`));
  if (time) { await page.clock.install({ time }); await page.clock.resume(); }
  await page.goto(BASE);
  await appReady(page);
  // Record what would be said aloud, and the status line, instead of speaking
  await page.evaluate(() => {
    window.__said = [];
    window.__status = [];
    speak = (text) => { window.__said.push(text); };
    const status = guidanceStatus;
    guidanceStatus = (html) => { if (html) window.__status.push(html.replace(/<[^>]+>/g, '')); status(html); };
  });
  return { context, page };
}

// Directions to a building from where you are, and Start (following your location)
async function startWalk(page, to) {
  await page.evaluate(async (to) => {
    document.getElementById('route-from').value = MY_LOCATION;
    routing.fromChosen = true;
    document.getElementById('route-to').value = to;
    await updateRoute(map);
  }, to);
  await page.click('#guidance-start-audio');
  await page.waitForFunction(() => guide.active && guide.watch !== null && guide.steps.length > 1);
  return page.evaluate(() => ({ line: guide.steps.flatMap((s) => s.coordinates), steps: guide.steps.map((s) => ({ kind: s.kind, type: s.type, length: s.length, coordinates: s.coordinates })) }));
}

// Feed fixes one at a time; returns the step index after each
async function feed(context, page, points, { accuracy = 8, ms = FIX_MS } = {}) {
  const indexes = [];
  for (const [longitude, latitude] of points) {
    await context.setGeolocation({ longitude, latitude, accuracy });
    await page.waitForTimeout(ms);
    indexes.push(await page.evaluate(() => (guide.active ? guide.index : -1)));
  }
  return indexes;
}

const arrived = (page) => page.evaluate(() => guide.active && guide.index === guide.steps.length - 1 && guide.steps.at(-1).kind === 'arrive');
const said = (page) => page.evaluate(() => window.__said);
const neverBackwards = (indexes) => indexes.every((v, i) => i === 0 || v === -1 || indexes[i - 1] === -1 || v >= indexes[i - 1]);

async function main() {
  const stopServer = await startServer(PORT);
  const browser = await launchBrowser();
  try {
    let context, page, route, indexes, spoken;
    // ---- A normal walk on campus ----
    if (run('normal')) {
    console.log('A normal walk: near Gasson Hall to McElroy Commons');
    ({ context, page } = await openWalk(browser));
    route = await startWalk(page, 'McElroy Commons');
    // 2 m a fix, near a real walking pace (about one fix a second)
    indexes = await feed(context, page, walkAlong(route.line, 2));
    expect(neverBackwards(indexes), 'normal', `steps move on in order, never backwards (${new Set(indexes).size} of ${route.steps.length} steps seen)`);
    // Every step longer than the gap between fixes was announced ("Step 3. Turn left…"): none passed in silence
    const announced = new Set((await said(page)).flatMap((t) => [...t.matchAll(/Step (\d+)\./g)].map((m) => Number(m[1]) - 1)));
    const missed = route.steps.map((st, i) => (st.length >= 3 || st.kind === 'arrive' ? i : -1)).filter((i) => i >= 0 && !announced.has(i));
    expect(!missed.length, 'normal', `every step was announced${missed.length ? ` (missed: ${missed.map((i) => `${i + 1}. ${route.steps[i].kind}`).join(', ')})` : ''}`);
    expect(await arrived(page), 'normal', 'reaches the arrival step at the end');
    spoken = await said(page);
    expect(spoken.some((t) => t.startsWith('Soon:')), 'normal', 'a heads-up before at least one turn ("Soon: …")');
    expect(spoken.some((t) => /Arrive/.test(t)), 'normal', 'arrival is said aloud');
    expect(!spoken.some((t) => /Off route/.test(t)), 'normal', 'never told it’s off route');
    await context.close();
    }

    // ---- A wrong turn ----
    if (run('wrong')) {
    console.log('A wrong turn: off the route partway, then on to the destination');
    ({ context, page } = await openWalk(browser));
    route = await startWalk(page, 'McElroy Commons');
    const points = walkAlong(route.line);
    const turnAt = Math.floor(points.length * 0.35);
    await feed(context, page, points.slice(0, turnAt));
    const before = await page.evaluate(() => guide.steps);
    // Head off sideways, about 8 m a fix, to about 60 m from the route
    const [ax, ay] = toXY(points[turnAt - 1]), [bx, by] = toXY(points[turnAt + 3] || points.at(-1));
    const len = Math.hypot(bx - ax, by - ay) || 1, side = [-(by - ay) / len, (bx - ax) / len];
    const away = Array.from({ length: 8 }, (_, k) => toLonLat([ax + side[0] * 8 * (k + 1), ay + side[1] * 8 * (k + 1)]));
    await feed(context, page, away, { ms: 400 });
    await page.waitForFunction(() => window.__said.some((t) => /Off route/.test(t)) && guide.active, null, { timeout: 20000 }).catch(() => {});
    spoken = await said(page);
    expect(spoken.some((t) => /Off route\. Finding a new route from here/.test(t)), 'wrong turn', 'notices after a few fixes off the route, and says so');
    await page.waitForFunction((old) => guide.active && JSON.stringify(guide.steps[0].start) !== JSON.stringify(old), before[0].start, { timeout: 20000 }).catch(() => {});
    const rerouted = await page.evaluate(() => guide.active && guide.watch !== null);
    expect(rerouted, 'wrong turn', 'a new route from where you are, still following your location');
    route = await page.evaluate(() => ({ line: guide.steps.flatMap((s) => s.coordinates) }));
    await feed(context, page, walkAlong(route.line));
    expect(await arrived(page), 'wrong turn', 'the new route gets you there');
    expect((await said(page)).filter((t) => /Off route/.test(t)).length === 1, 'wrong turn', 'only one re-route for one wrong turn');
    await context.close();
    }

    // ---- Poor signal ----
    if (run('poor')) {
    console.log('Poor signal: inaccurate fixes, then none, then back');
    ({ context, page } = await openWalk(browser));
    route = await startWalk(page, 'McElroy Commons');
    const walk = walkAlong(route.line);
    const half = Math.floor(walk.length / 2);
    indexes = await feed(context, page, walk.slice(0, half));
    const mid = await page.evaluate(() => guide.index);
    // Fixes 150 m inaccurate, scattered up to 80 m away (as near tall buildings), then six seconds with none
    const scattered = Array.from({ length: 6 }, () => { const [x, y] = toXY(walk[half]); return toLonLat([x + (random() - 0.5) * 160, y + (random() - 0.5) * 160]); });
    await feed(context, page, scattered, { accuracy: 150, ms: 300 });
    const status = await page.evaluate(() => window.__status.join(' | '));
    expect(/approximate/.test(status), 'poor signal', 'says the location is approximate');
    await page.waitForTimeout(6000);
    expect(await page.evaluate((mid) => guide.active && guide.index >= mid, mid), 'poor signal', 'keeps your place through the gap');
    indexes = await feed(context, page, walk.slice(half));
    expect(!(await said(page)).some((t) => /Off route/.test(t)), 'poor signal', 'no re-route from bad fixes');
    expect(await arrived(page), 'poor signal', 'carries on to arrival when the signal comes back');
    await context.close();
    }

    // ---- A shuttle ride ----
    if (run('shuttle')) {
    console.log('A shuttle ride: Gasson Hall to Kenny Cottle Library on a Wednesday morning');
    ({ context, page } = await openWalk(browser, { time: new Date('2026-10-21T14:00:00Z'), start: [-71.1703, 42.3356] }));
    route = await startWalk(page, 'Kenny Cottle Library');
    expect(route.steps.some((s) => s.kind === 'board'), 'shuttle', 'the walking directions include a shuttle ride');
    // On foot at walking spacing; on the bus at bus spacing, 35 m to one side of the drawn line (the far side of a
    // divided road, or a line drawn a little off), well beyond the 25 m that counts as off route on foot
    const legs = route.steps.flatMap((s) => (s.type === 'shuttle' ? walkAlong(s.coordinates, RIDE_STEP_M, 5, 35) : walkAlong(s.coordinates)));
    indexes = await feed(context, page, legs);
    spoken = await said(page);
    expect(neverBackwards(indexes), 'shuttle', 'steps move on in order through the ride');
    expect(!spoken.some((t) => /Off route|off the route/.test(t)), 'shuttle', 'riding the shuttle is never "off route"');
    expect(spoken.some((t) => /Get off at/.test(t)), 'shuttle', 'getting off is said aloud');
    expect(await arrived(page), 'shuttle', 'arrives at Kenny Cottle Library');
    await context.close();
    }
  } finally {
    await browser.close();
    stopServer();
  }
  if (problems.length) {
    console.log(`\nProblems:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nAll walks went as expected.');
}

main().catch((err) => { console.error(err); process.exit(1); });
