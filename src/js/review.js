// The data review page (review.html): the automatic entrance links, entrance points drawn inside their building,
// and buildings directions can't reach yet, each with "looks right / wrong / not sure" and a note, alongside a map.
// Answers are kept in this browser (localStorage) and downloaded as a spreadsheet (CSV) to send back.
//
// The list is worked out from the same data and graph code as the app, so it's always current.
import { buildGraph, projectBuildings, nearestBuilding, proj } from './routing/network.mjs';

const ANSWERS_KEY = 'accessbc.review';
const BOUNDS = [[-71.215, 42.305], [-71.135, 42.360]];
const VERDICTS = { right: 'Looks right', wrong: 'Wrong', unsure: 'Not sure' };

const load = async (name) => (await (await fetch(`src/geojson/${name}.geojson`)).json()).features;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const feet = (m) => `${Math.round(m * 3.28084).toLocaleString()} ft`;

let answers = {};
try { answers = JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}'); } catch { /* storage unavailable */ }
const saveAnswers = () => { try { localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers)); } catch { /* storage unavailable */ } };

// The things to review: [{id, group, title, detail, question, lonlat, line?}]
async function reviewItems() {
  const [paths, links, entrances, buildingFeatures, elevators] = await Promise.all(['accessiblepaths', 'entrance-links', 'entrances', 'buildings', 'elevators'].map(load));
  const items = [];
  for (const f of links) {
    const p = f.properties;
    items.push({
      id: `link-${p.Entrance}`, group: 'links', title: `${p.Building}: link to its entrance`, building: p.Building,
      detail: `${feet(p.Length_m)} to a ${p.To}${p.Campus ? `, ${p.Campus} campus` : ''}. Drawn automatically from the entrance to the nearest path.`,
      question: 'Can a wheelchair user get from this entrance to the path along this line? (Paved, level enough, no steps or high curbs.)',
      lonlat: f.geometry.coordinates[0], line: f.geometry.coordinates,
    });
    if (p.Check) {
      items.push({
        id: `door-${p.Entrance}`, group: 'doors', title: `${p.Building}: where is the accessible door?`, building: p.Building,
        detail: `The entrance point is drawn ${p.Check.match(/\d+ m/)?.[0] || 'well'} inside the building outline, so the door may be somewhere else.`,
        question: 'Is the accessible entrance where the marker is? If not, say which side of the building it’s on.',
        lonlat: f.geometry.coordinates[0],
      });
    }
  }
  // Buildings with an accessible entrance on the map that still can't be reached: no path or link to it
  const graph = buildGraph({ paths: [...paths, ...links], entrances, buildings: buildingFeatures, elevators });
  const projected = projectBuildings(buildingFeatures);
  const reached = new Set(graph.entrances.map((e) => e.building));
  const seen = new Set();
  for (const f of entrances) {
    const name = (f.properties.Building || '').trim() || nearestBuilding(projected, proj(f.geometry.coordinates)).name;
    if (!name || reached.has(name) || seen.has(name)) continue;
    seen.add(name);
    items.push({
      id: `unreached-${name}`, group: 'unreached', title: `${name}: no way to its entrance`, building: name,
      detail: 'Its accessible entrance is on the map, but no mapped path reaches it, so directions can’t go there.',
      question: 'Is there an accessible way to this entrance? If so, describe it (from which path, which side).',
      lonlat: f.geometry.coordinates,
    });
  }
  return items;
}

const GROUPS = {
  doors: { heading: 'Entrance points to check', intro: 'Entrance points drawn well inside their building outline.' },
  links: { heading: 'Links to entrances', intro: 'Short links drawn automatically from entrances to the nearest path, longest first. Directions use them, but nobody has checked them.' },
  unreached: { heading: 'Buildings directions can’t reach', intro: 'Accessible entrances on the map with no way to them.' },
};

function renderList(items) {
  const list = document.getElementById('items');
  list.innerHTML = Object.entries(GROUPS).map(([group, g]) => {
    const inGroup = items.filter((it) => it.group === group);
    if (!inGroup.length) return '';
    return `<section class="review-group" aria-labelledby="group-${group}">
      <h2 id="group-${group}">${g.heading} <span class="count">(${inGroup.length})</span></h2>
      <p>${g.intro}</p>
      <ol class="review-items">${inGroup.map((it) => {
        const a = answers[it.id] || {};
        return `<li class="review-item" data-id="${escapeHtml(it.id)}">
          <fieldset>
            <legend>${escapeHtml(it.title)}</legend>
            <p>${escapeHtml(it.detail)}</p>
            <p><strong>${escapeHtml(it.question)}</strong></p>
            <button type="button" class="show" data-show="${escapeHtml(it.id)}">Show on the map</button>
            <div class="verdicts">${Object.entries(VERDICTS).map(([v, label]) => `
              <label><input type="radio" name="v-${escapeHtml(it.id)}" value="${v}" data-verdict="${escapeHtml(it.id)}"${a.verdict === v ? ' checked' : ''}> ${label}</label>`).join('')}
            </div>
            <label class="note-label" for="note-${escapeHtml(it.id)}">Note</label>
            <textarea id="note-${escapeHtml(it.id)}" data-note="${escapeHtml(it.id)}" rows="2">${escapeHtml(a.note || '')}</textarea>
          </fieldset>
        </li>`;
      }).join('')}</ol>
    </section>`;
  }).join('');
}

function showProgress(items) {
  const done = items.filter((it) => answers[it.id]?.verdict).length;
  document.getElementById('progress').textContent = `${done} of ${items.length} reviewed.`;
}

const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function download(items) {
  const reviewer = document.getElementById('reviewer').value.trim();
  const rows = [['what', 'building', 'item', 'answer', 'note', 'latitude', 'longitude', 'reviewer', 'reviewed']];
  for (const it of items) {
    const a = answers[it.id];
    if (!a?.verdict && !a?.note) continue;
    rows.push([GROUPS[it.group].heading, it.building, it.id, a.verdict ? VERDICTS[a.verdict] : '', a.note || '', it.lonlat[1].toFixed(6), it.lonlat[0].toFixed(6), reviewer, a.at || '']);
  }
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\n') + '\n'], { type: 'text/csv' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `access-bc-review-${new Date().toISOString().slice(0, 10)}.csv` });
  link.click();
  URL.revokeObjectURL(link.href);
}

function setupMap(items) {
  maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
  const base = new URL('src/basemap/', document.baseURI).href;
  const map = new maplibregl.Map({
    container: 'map', center: [-71.1708, 42.3362], zoom: 16, maxBounds: BOUNDS,
    style: { version: 8, glyphs: `${base}fonts/{fontstack}/{range}.pbf`, sprite: `${base}sprites/white`, layers: BASEMAP_STYLES.white,
      sources: { protomaps: { type: 'vector', url: `pmtiles://${base}basemap.pmtiles`, attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } } },
  });
  map.on('load', () => {
    for (const name of ['buildings', 'accessiblepaths', 'entrance-links', 'entrances']) map.addSource(name, { type: 'geojson', data: `src/geojson/${name}.geojson` });
    map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-color': '#8fb3d9', 'fill-opacity': 0.45 } });
    map.addLayer({ id: 'paths', type: 'line', source: 'accessiblepaths', paint: { 'line-color': ['match', ['get', 'Type'], 'Interior', '#5F4690', '#0F8554'], 'line-width': 2 } });
    map.addLayer({ id: 'links', type: 'line', source: 'entrance-links', paint: { 'line-color': '#0F8554', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
    map.addLayer({ id: 'entrances', type: 'circle', source: 'entrances', paint: { 'circle-radius': 4, 'circle-color': '#f97b72' } });
    map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#c00000', 'line-width': 5 } });
    map.addLayer({ id: 'selected-point', type: 'circle', source: 'selected', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#c00000', 'circle-stroke-width': 3 } });
  });
  // Highlights an item and flies to it; if the map is still loading, as soon as it has
  const show = (item) => {
    const features = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: item.lonlat } }];
    if (item.line) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: item.line } });
    map.getSource('selected').setData({ type: 'FeatureCollection', features });
    map.flyTo({ center: item.lonlat, zoom: 19 });
  };
  return (item) => (map.getSource('selected') ? show(item) : map.once('load', () => show(item)));
}

async function main() {
  const items = await reviewItems();
  const order = { doors: 0, links: 1, unreached: 2 };
  // Entrance points first, then links (longest first: the likeliest to be wrong), then unreachable buildings
  const length = (it) => Number((it.detail.match(/^([\d,]+) ft/) || [0, '0'])[1].replace(/,/g, ''));
  items.sort((a, b) => order[a.group] - order[b.group] || (a.group === 'links' ? length(b) - length(a) : a.title.localeCompare(b.title)));
  renderList(items);
  showProgress(items);
  const show = setupMap(items);
  const byId = new Map(items.map((it) => [it.id, it]));
  const reviewer = document.getElementById('reviewer');
  try { reviewer.value = localStorage.getItem(`${ANSWERS_KEY}.reviewer`) || ''; } catch { /* storage unavailable */ }
  reviewer.addEventListener('change', () => { try { localStorage.setItem(`${ANSWERS_KEY}.reviewer`, reviewer.value); } catch { /* storage unavailable */ } });

  document.addEventListener('click', (e) => {
    const id = e.target.dataset?.show;
    if (id) show(byId.get(id));
  });
  document.addEventListener('change', (e) => {
    const { verdict, note } = e.target.dataset || {};
    const id = verdict || note;
    if (!id) return;
    answers[id] = { ...answers[id], at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    if (verdict) answers[id].verdict = e.target.value;
    if (note) answers[id].note = e.target.value.trim();
    saveAnswers();
    showProgress(items);
  });
  document.getElementById('download').addEventListener('click', () => download(items));
}

main();
