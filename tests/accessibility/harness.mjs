// Shared by check.mjs (accessibility checks) and walks.mjs (simulated walks): the local server, the browser, and
// opening the app ready to test.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

// CI machines have no graphics card, so the map is drawn in software. Tilting it into 3D (buildings and terrain)
// in step-by-step mode is then slow enough to freeze the page, so tests keep the map flat and still. That doesn't
// change anything they look at: the panels, dialogs, announcements, and directions.
export const LIGHT_MAP = { guidance3D: false, headingUp: false, reduceMotion: true };

// The site's preview server (it serves the map's byte ranges), on a port of its own. Returns a stop function.
export async function startServer(port) {
  const server = spawn('python3', ['scripts/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  return () => server.kill();
}

// Chromium with software WebGL, so the map renders on machines without a GPU (like CI)
export const launchBrowser = () => chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// Before the page loads: these settings saved, and the live-directions notice already accepted (or not)
export async function seedStorage(context, settings = {}, { noticeSeen = true } = {}) {
  await context.addInitScript(({ s, seen }) => {
    localStorage.setItem('accessbc.settings', JSON.stringify(s));
    if (seen) localStorage.setItem('accessbc.liveDirectionsNotice', 'understood');
  }, { s: { ...LIGHT_MAP, ...settings }, seen: noticeSeen });
}

// Routing is set up and the map's point data loaded
export const appReady = (page) => page.waitForFunction(() => typeof routing !== 'undefined' && routing && typeof routePoints !== 'undefined' && routePoints, null, { timeout: 60000 });
