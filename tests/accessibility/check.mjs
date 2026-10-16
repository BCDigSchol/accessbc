// Automated accessibility checks: loads the site in a real browser, walks through its main states (directions,
// step-by-step, dialogs, Find nearby, Where am I?, phone sizes, zoom, dark mode, the help page), runs axe-core
// against WCAG 2.2 AA in each, and checks keyboard and screen reader behaviour that axe can't see (skip link,
// focus moving into and out of dialogs, live announcements, arrow keys in step-by-step).
//
// Automated checks find only some problems. They don't replace testing with screen reader users
// (see docs/usability-testing/).
//
// Usage (from this folder): npm ci && npx playwright install chromium && npm run check
// Exits non-zero if axe finds serious or critical problems, or a behaviour check fails.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 8799;
const BASE = `http://localhost:${PORT}/`;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const FAIL_ON = new Set(['serious', 'critical']);
const ON_CAMPUS = { longitude: -71.17, latitude: 42.3355 }; // near Gasson Hall
// CI machines have no graphics card, so the map is drawn in software. Tilting it into 3D (buildings and terrain)
// in step-by-step mode is then slow enough to freeze the page, so these checks keep the map flat and still.
// That doesn't change anything the checks look at: the panels, dialogs, and announcements.
const LIGHT_MAP = { guidance3D: false, headingUp: false, reduceMotion: true };

const problems = [];   // failures: axe serious/critical, and failed behaviour checks
const notes = [];      // axe minor/moderate, reported but not failing

async function axe(page, state) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of result.violations) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('; ');
    const line = `[${state}] ${v.impact}: ${v.id}: ${v.help} (${v.nodes.length}x: ${where})`;
    (FAIL_ON.has(v.impact) ? problems : notes).push(line);
  }
  console.log(`  ${state}: ${result.violations.length ? result.violations.map((v) => `${v.id} (${v.impact})`).join(', ') : 'no axe violations'}`);
}

function expect(ok, state, message) {
  if (!ok) problems.push(`[${state}] ${message}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${state}: ${message}`);
}

const appReady = (page) => page.waitForFunction(() => typeof routing !== 'undefined' && routing && typeof routePoints !== 'undefined' && routePoints, null, { timeout: 60000 });

async function openApp(browser, { viewport = { width: 1280, height: 850 }, settings = {}, noticeSeen = true } = {}) {
  const context = await browser.newContext({ viewport, geolocation: ON_CAMPUS, permissions: ['geolocation'] });
  await context.addInitScript(({ s, seen }) => {
    localStorage.setItem('accessbc.settings', JSON.stringify(s));
    if (seen) localStorage.setItem('accessbc.liveDirectionsNotice', 'understood');
  }, { s: { ...LIGHT_MAP, ...settings }, seen: noticeSeen });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (err) => problems.push(`[page error] ${err.message}`));
  page.on('crash', () => problems.push('[page crashed]'));
  await page.goto(BASE);
  await appReady(page);
  return page;
}

// A route from a chosen start to a destination picked in Where to?, by keyboard, as a student would
async function findRoute(page, from = 'Gasson Hall', to = 'McElroy Commons') {
  await page.evaluate((f) => { document.getElementById('route-from').value = f; routing.fromChosen = true; }, from);
  await page.fill('#where-to', to);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#guidance-start-audio');
}

async function main() {
  const server = spawn('python3', ['scripts/serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  // Software WebGL, so the map renders on machines without a GPU (like CI)
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    console.log('Desktop');
    let page = await openApp(browser, { noticeSeen: false });
    await axe(page, 'start');

    // Keyboard: the skip link comes first and goes to Where to?
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id === 'skip-to-search'), 'keyboard', 'first Tab reaches the skip link');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement.id === 'where-to'), 'keyboard', 'skip link moves focus to Where to?');
    expect(await page.evaluate(() => document.getElementById('legend').hidden), 'start', 'the map key starts closed');

    await findRoute(page);
    expect(await page.evaluate(() => document.activeElement.id === 'route-title'), 'route', 'choosing a destination moves focus to the route');
    await page.waitForFunction(() => document.getElementById('announcer').textContent.startsWith('Route found'));
    expect(true, 'route', 'a found route is announced');
    await axe(page, 'route');
    // Avoid steep slopes: on to start with; one tap turns the limit off, finds the route again, and keeps focus
    expect(await page.evaluate(() => document.getElementById('slope-toggle').getAttribute('aria-pressed') === 'true'), 'route', 'Avoid steep slopes is on to start with');
    await page.click('#slope-toggle');
    await page.waitForFunction(() => document.getElementById('slope-toggle')?.getAttribute('aria-pressed') === 'false');
    expect(await page.evaluate(() => document.activeElement.id === 'slope-toggle' && document.getElementById('set-slope').value === '' && document.getElementById('opt-slope').value === ''),
      'route', 'Avoid steep slopes turns off the limit, in Edit trip and settings too, with focus kept on it');
    await page.click('#slope-toggle');
    await page.waitForFunction(() => document.getElementById('slope-toggle')?.getAttribute('aria-pressed') === 'true');
    await page.click('#edit-trip summary');
    await axe(page, 'route, Edit trip open');

    // Previewing step by step: focus on Next, arrow keys move between steps
    await page.click('#guidance-start');
    expect(await page.evaluate(() => document.activeElement.id === 'guidance-next'), 'preview', 'focus moves to Next');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => /^Step 2 of/.test(document.getElementById('guidance-progress').textContent)), 'preview', 'right arrow moves to step 2');
    await page.click('#guidance-exit');

    // Start, the first time: the notice that live directions are still in development
    await page.click('#guidance-start-audio');
    expect(await page.evaluate(() => !document.getElementById('live-notice').hidden && document.activeElement.id === 'live-notice-ok'),
      'live notice', 'the first Start shows the in-development notice, focus on I understand');
    await axe(page, 'live directions notice');
    await page.click('#live-notice-ok');
    // Start: walk mode, following your location; More holds the other tools
    expect(await page.evaluate(() => currentView() === 'walk' && document.activeElement.id === 'guidance-repeat'), 'walk', 'Start opens walk mode with focus on Repeat');
    await axe(page, 'walk');
    await page.click('#walk-more');
    await axe(page, 'walk, More open');
    await page.click('.walk-more .where-am-i');
    await page.waitForFunction(() => /building|route/.test(document.getElementById('walk-where').textContent));
    await axe(page, 'walk, Where am I?');
    await page.click('#guidance-exit');
    expect(await page.evaluate(() => currentView() === 'route' && document.activeElement.id === 'guidance-start-audio'), 'walk', 'End returns to the route, focus on Start');

    // Building information, from the route preview
    await page.click('[data-building-info]');
    await page.waitForSelector('#building-popup.visible');
    expect(await page.evaluate(() => document.getElementById('building-popup').contains(document.activeElement)), 'building info', 'focus moves into the building dialog');
    await axe(page, 'building info');
    await page.keyboard.press('Escape');

    // Quick search: the nearest single-stall restrooms
    await page.click('#route-back');
    await page.click('.chip[data-find="restroom"]');
    await page.waitForSelector('.nearby-list');
    expect(await page.evaluate(() => document.activeElement.id === 'results-title'), 'results', 'a quick search moves focus to its results');
    await axe(page, 'results');
    await page.click('#results-back');

    // More…: every kind of thing, spelled out
    await page.click('#chip-more');
    expect(await page.evaluate(() => !document.getElementById('more-kinds').hidden && document.getElementById('more-kinds').contains(document.activeElement)), 'more', 'More… lists every kind of thing, focus on the first');
    await axe(page, 'more kinds');
    await page.click('#more-kinds [data-find="printing"]');
    await page.waitForSelector('.nearby-list');
    await page.click('#results-back');

    // Menu: focus moves in, Escape closes it and returns focus
    await page.click('#menu-toggle');
    expect(await page.evaluate(() => document.getElementById('app-menu').contains(document.activeElement)), 'menu', 'focus moves into the menu');
    await axe(page, 'menu');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.getElementById('app-menu').hidden && document.activeElement.id === 'menu-toggle'), 'menu', 'Escape closes it and focus returns to the menu button');

    // Settings dialog, from the menu
    await page.click('#menu-toggle');
    await page.click('#settings-toggle');
    expect(await page.evaluate(() => document.getElementById('settings-dialog').contains(document.activeElement)), 'settings', 'focus moves into the dialog');
    await axe(page, 'settings dialog');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.getElementById('settings-dialog').hidden && document.activeElement.id === 'menu-toggle'),
      'settings', 'Escape closes it and focus returns to the menu button');

    // Map key, from the Layers button
    await page.click('.layers-toggle');
    expect(await page.evaluate(() => !document.getElementById('legend').hidden && document.activeElement.classList.contains('legend-close')), 'map layers', 'Layers opens the key, focus on its Close button');
    await axe(page, 'map layers');
    await page.keyboard.press('Escape');

    // Blue light: straight into walking directions to the nearest emergency phone, with the numbers to call
    await page.click('.panel-top .emergency-button');
    await page.waitForFunction(() => currentView() === 'walk' && routing.place?.emergency);
    expect(await page.evaluate(() => document.activeElement.id === 'guidance-repeat' && !document.getElementById('walk-emergency').hidden),
      'blue light', 'Blue light starts directions to the nearest phone, with BC Police and 911 in view');
    await axe(page, 'blue light');
    await page.click('#guidance-exit');
    await page.context().close();

    console.log('Dark mode, bigger symbols, large step view');
    page = await openApp(browser, { settings: { darkMode: true, largeSymbols: true, bigSteps: true } });
    await findRoute(page);
    await axe(page, 'dark: route');
    await page.click('#guidance-start-audio');
    await axe(page, 'dark: large walk view');
    await page.context().close();

    console.log('Phone');
    page = await openApp(browser, { viewport: { width: 375, height: 812 } });
    await axe(page, 'phone: start');
    await findRoute(page);
    await axe(page, 'phone: route');
    await page.click('#guidance-start-audio');
    await axe(page, 'phone: walk');
    // Away from campus, Blue light can't find a phone: it says so, and gives the numbers to call
    await page.context().setGeolocation({ longitude: -71.06, latitude: 42.36 });
    await page.evaluate(() => { guide.lastFix = null; });
    await page.click('.walk-emergency-button');
    await page.waitForFunction(() => /away from campus/.test(document.getElementById('emergency-message-text').textContent));
    expect(await page.evaluate(() => document.activeElement.id === 'emergency-message' && !!document.querySelector('#emergency-message a[href^="tel:"]')),
      'phone: blue light', 'away from campus, Blue light explains and offers the numbers to call');
    await axe(page, 'phone: blue light message');
    await page.context().close();

    console.log('Zoomed to 400% (320 x 256)');
    page = await openApp(browser, { viewport: { width: 320, height: 256 } });
    await findRoute(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'zoom 400%', 'no sideways scrolling');
    await page.context().close();

    console.log('Help page');
    for (const settings of [{}, { darkMode: true }]) {
      const context = await browser.newContext();
      await context.addInitScript((s) => localStorage.setItem('accessbc.settings', JSON.stringify(s)), settings);
      page = await context.newPage();
      await page.goto(BASE + 'help.html');
      await axe(page, settings.darkMode ? 'help (dark)' : 'help');
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (notes.length) console.log(`\nMinor and moderate issues (not failing the check):\n${notes.map((n) => `  ${n}`).join('\n')}`);
  if (problems.length) {
    console.log(`\nProblems:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nAll accessibility checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
