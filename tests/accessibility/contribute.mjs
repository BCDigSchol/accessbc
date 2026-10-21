// The contributions loop in a real browser, with the real Sheet script (scripts/contributions/Code.gs) running in a
// stand-in for Google (tests/contributions/fake-apps-script.mjs):
//   a volunteer adds an entrance on the contribute page → the app routes to the building, marked not verified →
//   the admin verifies it → the app routes there as checked → a member of the public's report arrives as a suggestion.
// Also runs axe on the contribute page.
//
// Usage (from this folder): npm run contribute
import AxeBuilder from '@axe-core/playwright';
import { startServer, launchBrowser, seedStorage, appReady } from './harness.mjs';
import { fakeAppsScript } from '../contributions/fake-apps-script.mjs';

const PORT = 8797, BASE = `http://localhost:${PORT}/`;
const SHEET_URL = 'https://script.google.com/macros/s/TEST-SHEET/exec';
const HOUSING_DOOR = [-71.1667219, 42.3372526]; // Modular Housing Unit 3: no accessible entrance in the data
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const problems = [];
const expect = (ok, what, message) => { if (!ok) problems.push(`[${what}] ${message}`); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}: ${message}`); };
async function axe(page, what) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(!bad.length, what, `no serious accessibility problems${bad.length ? `: ${bad.map((v) => v.id).join(', ')}` : ''}`);
}

async function main() {
  const stopServer = await startServer(PORT);
  const browser = await launchBrowser();
  const sheet = fakeAppsScript();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, geolocation: { longitude: -71.17, latitude: 42.3355 }, permissions: ['geolocation'] });
    await seedStorage(context);
    // This copy of the site points at the stand-in Sheet
    await context.route('**/src/js/config.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: `const CONTRIBUTIONS_URL = '${SHEET_URL}';` }));
    await context.route(`${SHEET_URL}*`, (route) => {
      const req = route.request();
      const out = req.method() === 'POST' ? sheet.post(req.postData()) : sheet.get();
      route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (err) => problems.push(`[page error] ${err.message}`));

    console.log('A volunteer adds an entrance');
    await page.goto(BASE + 'contribute.html');
    await page.waitForFunction(() => document.querySelectorAll('#building option').length > 10);
    await axe(page, 'contribute page');
    await page.fill('#passcode', sheet.passcodes.volunteer);
    await page.fill('#email', 'sam@bc.edu');
    await page.fill('#contributor', 'Sam');
    await page.selectOption('#building', 'Modular Housing Unit  3');
    // Choose the spot on the map
    await page.click('#pick-point');
    await page.waitForFunction(() => window.map?.loaded());
    // Centre the map on the door, then click there
    await page.evaluate((door) => window.map.jumpTo({ center: door, zoom: 19 }), HOUSING_DOOR);
    await page.waitForTimeout(800);
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(/Entrance at 42\.3372/.test(await page.textContent('#point-status')), 'add', 'choosing the spot on the map places the entrance');
    await page.fill('#note', 'Ramp from the path on the west side.');
    await page.click('#submit');
    await page.waitForFunction(() => /Added:|Not added|Couldn/.test(document.getElementById('submit-status').textContent));
    expect(/Added: Entrance of Modular Housing Unit +3/.test(await page.textContent('#submit-status')), 'add', 'the entrance is added');
    expect(sheet.rows().at(-1)?.[3] === 'unverified', 'add', 'it’s in the Sheet, unverified');
    expect(sheet.rows().at(-1)?.[6] === 'sam@bc.edu', 'add', 'with the volunteer’s email');

    console.log('The app routes to it, marked not verified');
    const routeTo = async () => {
      await page.goto(BASE);
      await appReady(page);
      return page.evaluate(async () => {
        document.getElementById('route-from').value = 'Gasson Hall'; routing.fromChosen = true;
        document.getElementById('route-to').value = 'Modular Housing Unit  3';
        await updateRoute(map);
        return { found: !!routing.current, text: document.getElementById('route-result').textContent };
      });
    };
    let r = await routeTo();
    expect(r.found, 'app', 'directions to Modular Housing Unit 3, through the volunteer’s entrance');
    expect(/added by a volunteer and hasn’t been verified/.test(r.text), 'app', 'the route says part of it isn’t verified yet');

    console.log('The admin verifies it');
    await page.goto(BASE + 'contribute.html');
    await page.click('#tab-review');
    await page.fill('#admin', sheet.passcodes.admin);
    await page.fill('#reviewer', 'Dana');
    await page.click('#load-entries');
    await page.waitForSelector('[data-review][data-status="verified"]');
    await axe(page, 'review entries');
    await page.click('[data-review][data-status="verified"]');
    await page.waitForFunction(() => /Verified:/.test(document.getElementById('review-status').textContent));
    expect(sheet.rows().at(-1)?.[3] === 'verified', 'verify', 'it’s verified in the Sheet');
    await page.evaluate(() => localStorage.removeItem('accessbc.contributions')); // as after the saved copy expires
    r = await routeTo();
    expect(r.found && !/hasn’t been verified/.test(r.text), 'verify', 'the route uses it as checked');

    console.log('A member of the public reports a missing entrance');
    await page.evaluate(() => openBuildingInfo({ NAME: '19 Mayflower Rd' }));
    await page.click('[data-report-problem="map"]');
    await page.click('#report-send-feedback');
    await page.waitForFunction(() => /Sent to Access BC|copied|opened/.test(document.getElementById('report-status').textContent));
    expect(/Sent to Access BC/.test(await page.textContent('#report-status')), 'report', 'sent straight to Access BC');
    expect(sheet.rows().at(-1)?.[3] === 'suggestion', 'report', 'it arrives as a suggestion (not used in routes)');
    await context.close();
  } finally {
    await browser.close();
    stopServer();
  }
  if (problems.length) { console.log(`\nProblems:\n${problems.map((p) => `  ${p}`).join('\n')}`); process.exit(1); }
  console.log('\nThe contributions loop works.');
}

main().catch((err) => { console.error(err); process.exit(1); });
