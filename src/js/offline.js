// Working offline: registers the service worker (sw.js), then asks it to save everything the app needs, so the
// map, directions, and Where am I? keep working with no signal. That's the files this page has loaded, the data it
// loads only when needed (city sidewalks, shuttles), and the basemap and terrain (about 9 MB, once). Not with
// Data Saver on: then only what's been used is saved.
//
// While offline, a note says what still works.

const OFFLINE_DATA = ['src/geojson/sidewalks.geojson', 'src/geojson/shuttles.json', 'src/geojson/mbta-trains.json', 'src/js/routing/city-worker.mjs', 'help.html'];
const OFFLINE_MAPS = ['src/basemap/basemap.pmtiles', 'src/basemap/terrain.pmtiles'];

// The browser records loaded files in a buffer of 250 by default, which the map's tile requests soon fill; make room,
// so the list of files to save is complete. (Map tiles aren't on the list: the whole map files are saved instead.)
try { performance.setResourceTimingBufferSize(5000); } catch { /* not supported: some files are saved on a later visit */ }

function showOfflineNote() {
  const note = document.getElementById('offline-note');
  if (!note) return;
  note.hidden = navigator.onLine;
}

async function saveForOffline() {
  if (!('serviceWorker' in navigator)) return;
  let registration;
  try {
    registration = await navigator.serviceWorker.register('sw.js');
  } catch {
    return; // not allowed here (a private window, or an http:// address other than localhost)
  }
  await navigator.serviceWorker.ready;
  const worker = navigator.serviceWorker.controller || registration.active;
  if (!worker) return;
  const sameSite = (u) => { try { const url = new URL(u, location.href); return url.origin === location.origin && !url.pathname.endsWith('.pmtiles'); } catch { return false; } };
  const loaded = performance.getEntriesByType('resource').map((e) => e.name).filter(sameSite);
  const saveData = navigator.connection?.saveData;
  // The page itself under its address without the query (?from=…&to=…), as the service worker saves pages
  worker.postMessage({ type: 'save-files', urls: [location.origin + location.pathname, ...loaded, ...(saveData ? [] : OFFLINE_DATA.map((u) => new URL(u, location.href).href))] });
  if (!saveData) worker.postMessage({ type: 'save-maps', urls: OFFLINE_MAPS.map((u) => new URL(u, location.href).href) });
}

window.addEventListener('online', showOfflineNote);
window.addEventListener('offline', showOfflineNote);
// After the page and map have loaded, so saving never slows down the first route
window.addEventListener('load', () => {
  showOfflineNote();
  setTimeout(saveForOffline, 3000);
});
