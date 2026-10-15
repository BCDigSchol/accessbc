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

async function openApp(browser, { viewport = { width: 1280, height: 850 }, settings = {} } = {}) {
  const context = await browser.newContext({ viewport, geolocation: ON_CAMPUS, permissions: ['geolocation'] });
  await context.addInitScript((s) => localStorage.setItem('accessbc.settings', JSON.stringify(s)), settings);
  const page = await context.newPage();
  page.on('pageerror', (err) => problems.push(`[page error] ${err.message}`));
  await page.goto(BASE);
  await appReady(page);
  return page;
}

async function findRoute(page, from = 'Gasson Hall', to = 'McElroy Commons') {
  await page.evaluate(() => { if (document.getElementById('directions-panel').hidden) document.getElementById('directions-toggle').click(); });
  await page.selectOption('#route-from', from);
  await page.selectOption('#route-to', to);
  await page.waitForSelector('#guidance-start');
}

async function main() {
  const server = spawn('python3', ['scripts/serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  // Software WebGL, so the map renders on machines without a GPU (like CI)
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    console.log('Desktop');
    let page = await openApp(browser);
    await axe(page, 'start');

    // Keyboard: the skip link comes first and opens the directions panel
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id === 'skip-to-directions'), 'keyboard', 'first Tab reaches the skip link');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => !document.getElementById('directions-panel').hidden && document.activeElement.id === 'route-from'),
      'keyboard', 'skip link opens directions with focus on From');

    await findRoute(page);
    await page.waitForFunction(() => document.getElementById('announcer').textContent.startsWith('Route found'));
    expect(true, 'route', 'a found route is announced');
    await axe(page, 'route');

    // Step-by-step: focus on Next, arrow keys move between steps
    await page.click('#guidance-start');
    expect(await page.evaluate(() => document.activeElement.id === 'guidance-next'), 'step-by-step', 'focus moves to Next');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => /^Step 2 of/.test(document.getElementById('guidance-progress').textContent)), 'step-by-step', 'right arrow moves to step 2');
    await axe(page, 'step-by-step');
    await page.click('.guidance-tools .where-am-i');
    await page.waitForFunction(() => /building|route/.test(document.getElementById('guidance-status').textContent));
    await axe(page, 'step-by-step, Where am I?');
    await page.click('#guidance-exit');

    // Find nearby
    await page.evaluate(() => { document.querySelector('details.nearby').open = true; });
    await page.selectOption('#nearby-from', 'me');
    await page.click('#nearby-search');
    await page.waitForSelector('.nearby-list');
    await axe(page, 'Find nearby');

    // Settings dialog: focus moves in, Escape closes it and returns focus
    await page.click('#settings-toggle');
    expect(await page.evaluate(() => document.getElementById('settings-dialog').contains(document.activeElement)), 'settings', 'focus moves into the dialog');
    await axe(page, 'settings dialog');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.getElementById('settings-dialog').hidden && document.activeElement.id === 'settings-toggle'),
      'settings', 'Escape closes it and focus returns to the Accessibility button');

    // Building information, opened from search (the way to reach it without the map)
    await page.fill('#generic-search', 'Fulton');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#building-popup.visible');
    expect(await page.evaluate(() => document.getElementById('building-popup').contains(document.activeElement)), 'building info', 'focus moves into the building dialog');
    await axe(page, 'building info');
    await page.keyboard.press('Escape');
    await page.context().close();

    console.log('Dark mode, bigger symbols, large step view');
    page = await openApp(browser, { settings: { darkMode: true, largeSymbols: true, bigSteps: true } });
    await findRoute(page);
    await axe(page, 'dark: route');
    await page.click('#guidance-start');
    await axe(page, 'dark: large step view');
    await page.context().close();

    console.log('Phone');
    page = await openApp(browser, { viewport: { width: 375, height: 812 } });
    expect(await page.evaluate(() => document.getElementById('legend').classList.contains('panel-collapsed')), 'phone', 'the legend starts closed');
    await axe(page, 'phone: start');
    await findRoute(page);
    await axe(page, 'phone: route');
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
