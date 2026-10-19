// Access BC's service worker: keeps the app working with weak or no signal (between buildings, indoors).
//
// - Pages, scripts, styles, data, fonts and icons: fresh from the network when it answers within NETWORK_WAIT_MS,
//   otherwise (offline, or a very slow connection) the saved copy. Every file fetched is saved.
// - The basemap and terrain (.pmtiles): the map reads small byte ranges of these large files. Once a whole file has
//   been saved (offline.js asks for this after the page loads), every range is served from it, so the whole map
//   works offline; until then, ranges come from the network. Once per launch, a saved file is compared with the
//   server's (ETag or Last-Modified), and downloaded again when it has changed.
//
// It has to be at the site root to cover the whole site. Changing CACHE_VERSION clears the saved copies.
const CACHE_VERSION = 1;
const APP_CACHE = `accessbc-app-v${CACHE_VERSION}`;
const MAP_CACHE = `accessbc-maps-v${CACHE_VERSION}`;
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![APP_CACHE, MAP_CACHE].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.pmtiles')) event.respondWith(mapRange(request, url));
  else event.respondWith(networkFirst(request));
});

// The network if it answers in time (saving what it sends); otherwise the saved copy, of this version of the file
// or, failing that, any version (a script saved as app.js?v=old serves app.js?v=new offline)
async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch { /* offline: use the saved copy */ }
  const saved = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }))
    || (request.mode === 'navigate' ? await cache.match(new URL('./', self.location).href, { ignoreSearch: true }) : null);
  if (saved) return saved;
  return network; // nothing saved: whatever the network does (an error offline)
}

// ---- The basemap and terrain ----

const savedMaps = new Map(); // url -> {blob, headers}, read from the cache once
const checked = new Set();   // files compared with the server's this launch

async function savedMap(url) {
  if (savedMaps.has(url)) return savedMaps.get(url);
  const response = await (await caches.open(MAP_CACHE)).match(url);
  if (!response) return null;
  const entry = { blob: await response.blob(), headers: response.headers };
  savedMaps.set(url, entry);
  return entry;
}

async function mapRange(request, url) {
  const file = url.origin + url.pathname;
  const saved = await savedMap(file);
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!saved || !range) return fetch(request);
  if (!checked.has(file)) { checked.add(file); refreshMap(file, saved.headers); }
  const size = saved.blob.size;
  const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const headers = new Headers({
    'Content-Type': saved.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
  });
  for (const h of ['ETag', 'Last-Modified']) if (saved.headers.get(h)) headers.set(h, saved.headers.get(h));
  return new Response(saved.blob.slice(start, end + 1), { status: 206, headers });
}

// Download a whole map file into the cache (when it isn't saved yet, or the server's copy has changed)
async function saveMap(file) {
  const response = await fetch(file, { cache: 'no-store' });
  if (!response.ok || response.status !== 200) return false;
  await (await caches.open(MAP_CACHE)).put(file, response);
  savedMaps.delete(file); // read the new copy next time (the page uses the old one until it reloads)
  return true;
}

async function refreshMap(file, headers) {
  try {
    const head = await fetch(file, { method: 'HEAD', cache: 'no-store' });
    const changed = ['ETag', 'Last-Modified'].some((h) => head.headers.get(h) && headers.get(h) && head.headers.get(h) !== headers.get(h));
    if (head.ok && changed) await saveMap(file);
  } catch { /* offline: keep the saved copy */ }
}

// ---- Messages from offline.js ----

self.addEventListener('message', (event) => {
  const { type, urls = [] } = event.data || {};
  const reply = (message) => event.source?.postMessage(message);
  if (type === 'save-files') {
    // Files the page has loaded (and data it may need later), saved now so they're there offline
    event.waitUntil((async () => {
      const cache = await caches.open(APP_CACHE);
      await Promise.all(urls.map(async (u) => {
        if (await cache.match(u)) return;
        try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch { /* try again next time */ }
      }));
      reply({ type: 'files-saved' });
    })());
  }
  if (type === 'save-maps') {
    event.waitUntil((async () => {
      let saved = 0;
      for (const u of urls) {
        const file = new URL(u, self.location).href;
        if (await savedMap(file)) { saved++; continue; } // already saved
        try { if (await saveMap(file)) saved++; } catch { /* offline or interrupted: next time */ }
      }
      reply({ type: 'maps-saved', saved, total: urls.length });
    })());
  }
});
