// Problems with elevators, entrances, blue-light phones, buildings and paths: reporting them, and avoiding them.
//
// "Report a problem" opens a short form about a map feature, a building, or where you are. The report goes to
// whoever can act on it: BC Facilities (UpKeep) fixes things on campus; Access BC's feedback form is for the map.
// Neither can be filled in from here, so the report is copied, ready to paste. Once Access BC has a Google Form
// for reports, set REPORT_FORM (its "Get pre-filled link" entry ids) and the form opens with the report filled in.
//
// Something you report as not working is also avoided in your own routes on this device straight away, for
// REPORT_DAYS days or until you say it's working again. Features the map data marks as not working (a Status other
// than "Working") are avoided for everyone. Routes still use them when there's no other way, and say so.

const REPORT_FORM = null; // { url: 'https://docs.google.com/forms/d/e/…/viewform', fields: { about: 'entry.…', problem: 'entry.…', details: 'entry.…', where: 'entry.…' } }
const UPKEEP_URL = 'https://app.onupkeep.com/#/login/setup-sso?companyId=BostonCollege';
const MY_REPORTS_KEY = 'accessbc.myReports';
const REPORT_DAYS = 3;
const REPORTABLE = { entrances: 'OBJECTID', elevators: 'OBJECTID', bluelights: 'ObjectID' }; // layer -> its id field
const REPORT_PROBLEMS = {
  'not-working': 'Not working or out of service',
  blocked: 'Blocked (construction, snow, something in the way)',
  hard: 'Hard to use, or unsafe',
  map: 'Wrong or missing on the map',
  other: 'Something else',
};
const BROKEN_PENALTY_M = 3000; // a route uses something reported not working only if the way round is this much longer

// ---- Your reports, on this device ----------------------------------------------------------------------

let myReportsList = null; // [{layer, id, at}], read from storage once
function myReports() {
  if (!myReportsList) {
    try { myReportsList = JSON.parse(localStorage.getItem(MY_REPORTS_KEY) || '[]'); } catch { myReportsList = []; }
  }
  myReportsList = myReportsList.filter((r) => Date.now() - r.at < REPORT_DAYS * 864e5);
  return myReportsList;
}

function setMyReport(layer, id, on) {
  const others = myReports().filter((r) => !(r.layer === layer && r.id === id));
  myReportsList = on ? [...others, { layer, id, at: Date.now() }] : others;
  try { localStorage.setItem(MY_REPORTS_KEY, JSON.stringify(myReportsList)); } catch { /* storage unavailable */ }
  markReported();
}

const myReportFor = (layer, id) => myReports().find((r) => r.layer === layer && r.id === id);

// Whether a feature is reported not working: in the map data, or by you (marked by markReported)
function isReportedBroken(feature) {
  const { Status, reported } = feature.properties;
  return !!reported || (!!Status && Status !== 'Working');
}

// Marks the features you've reported, in every copy of the data (routing's, and the map's), and redraws the map
function markReported() {
  const copies = [];
  if (routing?.data) copies.push(['entrances', routing.data.entrances], ['elevators', routing.data.elevators]);
  if (routePoints) for (const layer of Object.keys(REPORTABLE)) copies.push([layer, routePoints[layer]?.features || []]);
  for (const [layer, features] of copies) {
    for (const f of features) f.properties.reported = !!myReportFor(layer, f.properties[REPORTABLE[layer]]);
  }
  const map = window.map;
  if (!map || !routePoints) return;
  if (pointsFiltered && routing.routeCoordinates) showOnlyPointsNear(map, routing.routeCoordinates);
  else for (const layer of Object.keys(REPORTABLE)) map.getSource(layer)?.setData(routePoints[layer]);
}

// ---- Avoiding what's reported not working --------------------------------------------------------------

// The building an indoor edge is in, for each indoor edge of a graph (worked out the first time it's needed)
function interiorEdgeBuildings(graph) {
  if (graph.interiorBuilding) return graph.interiorBuilding;
  const { proj, nearestBuilding } = routing.module;
  graph.interiorBuilding = new Map();
  graph.adjacency.forEach((edges, a) => {
    for (const e of edges) {
      if (e.type !== 'Interior') continue;
      const p = proj(graph.nodes[a]), q = proj(graph.nodes[e.to]);
      const near = nearestBuilding(graph.buildings, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
      if (near.d <= 5) graph.interiorBuilding.set(e, near.name);
    }
  });
  return graph.interiorBuilding;
}

// What to steer round on a graph: the door links of entrances reported not working, and indoor routes through
// buildings with an elevator reported not working (the route might need it). {edges, doorNodes: node -> building,
// elevatorBuildings}
function brokenOnGraph(graph) {
  const { module, data } = routing;
  const edges = new Set(), doorNodes = new Map(), elevatorBuildings = new Set();
  const brokenDoors = new Set(data.entrances.filter(isReportedBroken).map((f) => f.properties.OBJECTID));
  for (const door of graph.entrances) {
    if (!brokenDoors.has(door.id)) continue;
    doorNodes.set(door.node, door.building);
    for (const e of graph.adjacency[door.node]) {
      edges.add(e);
      for (const back of graph.adjacency[e.to]) if (back.to === door.node) edges.add(back);
    }
  }
  for (const f of data.elevators.filter(isReportedBroken)) {
    const near = module.nearestBuilding(graph.buildings, module.proj(f.geometry.coordinates));
    const name = (f.properties.Building || '').trim() || (near.d <= 5 ? near.name : '');
    if (name) elevatorBuildings.add(name);
  }
  if (elevatorBuildings.size) {
    for (const [e, building] of interiorEdgeBuildings(graph)) if (elevatorBuildings.has(building)) edges.add(e);
  }
  return { edges, doorNodes, elevatorBuildings };
}

// Notes for a found route: what it avoided at its ends, and anything reported not working it couldn't avoid.
// Returns {html, text}.
function brokenRouteNotes(graph, route, ends) {
  const avoid = brokenOnGraph(graph);
  if (!avoid.doorNodes.size && !avoid.elevatorBuildings.size) return { html: '', text: '' };
  const warnings = [], notes = [];
  const usedDoors = new Set(route.nodes.filter((n) => avoid.doorNodes.has(n)).map((n) => avoid.doorNodes.get(n)));
  for (const b of usedDoors) {
    const doors = graph.entrances.filter((e) => e.building === b);
    warnings.push(doors.every((e) => avoid.doorNodes.has(e.node))
      ? `${doors.length === 1 ? 'The only mapped accessible entrance' : 'Every mapped accessible entrance'} of ${b} is reported not working. Check before you go, or ask for help at the door.`
      : `This route uses an accessible entrance of ${b} that’s reported not working, because no other route was found.`);
  }
  const through = new Set();
  for (let i = 1; i < route.nodes.length; i++) {
    const edge = graph.adjacency[route.nodes[i - 1]].find((e) => e.to === route.nodes[i]);
    if (edge?.type === 'Interior' && avoid.edges.has(edge)) through.add(graph.interiorBuilding.get(edge));
  }
  for (const b of through) warnings.push(`This route goes through ${b}, where an elevator is reported not working.`);
  for (const b of ends) {
    if (!usedDoors.has(b) && [...avoid.doorNodes.values()].includes(b)) notes.push(`An accessible entrance of ${b} is reported not working, so this route uses another one.`);
    if (avoid.elevatorBuildings.has(b) && !through.has(b)) notes.push(`An elevator in ${b} is reported not working.`);
  }
  return {
    html: [...warnings.map((w) => `<p class="route-warning">${escapeHtml(w)}</p>`), ...notes.map((n) => `<p class="route-note">${escapeHtml(n)}</p>`)].join(''),
    text: [...warnings, ...notes].join(' '),
  };
}

// ---- The report form -----------------------------------------------------------------------------------

let reportTarget = null; // {about, lonlat?, layer?, id?}
let reportReturnFocus = null;
let reportAvoidChanged = false;

// Opens the form about a target: {layer, feature} for a map feature, {building} for a building, or {here: true}
async function openReport(target) {
  const dialog = document.getElementById('report-dialog');
  reportReturnFocus = document.activeElement;
  reportAvoidChanged = false;
  dialog.querySelectorAll('input[name="report-problem"]').forEach((r) => { r.checked = false; });
  document.getElementById('report-details').value = '';
  document.getElementById('report-status').textContent = '';
  const avoidRow = document.getElementById('report-avoid-row'), avoid = document.getElementById('report-avoid');

  if (target.feature) {
    const { layer, feature } = target;
    const id = feature.properties[REPORTABLE[layer]];
    reportTarget = { about: featureName(layer, feature), lonlat: feature.geometry.coordinates, layer, id };
    const mine = myReportFor(layer, id);
    avoidRow.hidden = false;
    avoid.checked = !!mine;
    document.getElementById('report-avoid-note').textContent = mine
      ? `You reported this ${timeAgo(mine.at)}. Uncheck this if it’s working again.`
      : feature.properties.Status && feature.properties.Status !== 'Working' ? 'It’s already reported not working in the map data, so routes avoid it.' : '';
  } else if (target.building) {
    reportTarget = { about: target.building };
    avoidRow.hidden = true;
  } else {
    reportTarget = { about: 'Where I am' };
    avoidRow.hidden = true;
  }
  // Started from a specific question ("Tell us where its accessible entrance is"): the answer is half filled in
  if (target.problem) document.getElementById(`report-problem-${target.problem}`).checked = true;
  if (target.details) document.getElementById('report-details').value = target.details;
  document.getElementById('report-about').textContent = reportTarget.about;
  document.getElementById('report-where').textContent = reportTarget.lonlat ? `Location: ${formatLonlat(reportTarget.lonlat)}` : target.here ? 'Finding your location…' : '';
  dialog.hidden = false;
  document.getElementById('report-close').focus();

  if (target.here) {
    try {
      const fix = await currentFix();
      reportTarget.lonlat = fix.lonlat;
      const near = routing && routing.module.nearestBuilding(currentGraph().buildings, routing.module.proj(fix.lonlat));
      if (near?.name) reportTarget.about = `Where I am, ${near.d < 1 ? 'in' : `about ${feet(near.d)} from`} ${near.name}`;
      document.getElementById('report-about').textContent = reportTarget.about;
      document.getElementById('report-where').textContent = `Your location: ${formatLonlat(fix.lonlat)}`;
    } catch {
      document.getElementById('report-where').textContent = 'Your location isn’t available, so please say where in the details.';
    }
  }
}

function featureName(layer, feature) {
  const p = feature.properties, building = (p.Building || '').trim();
  const near = () => {
    if (!routing) return '';
    const b = routing.module.nearestBuilding(currentGraph().buildings, routing.module.proj(feature.geometry.coordinates));
    return b.name ? ` near ${b.name}` : '';
  };
  if (layer === 'elevators') return `Elevator${building ? ` in ${building}` : near()}`;
  if (layer === 'entrances') return `Accessible entrance${building ? ` of ${building}` : near()}`;
  return `Blue-light emergency phone${near()}`;
}

const formatLonlat = ([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

function timeAgo(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} ago` : `${Math.round(hours / 24)} days ago`;
}

function reportText() {
  const problem = document.querySelector('input[name="report-problem"]:checked')?.value;
  const details = document.getElementById('report-details').value.trim();
  return [
    'Access BC report',
    `About: ${reportTarget.about}${reportTarget.id !== undefined ? ` (${reportTarget.layer} ${reportTarget.id})` : ''}`,
    `Problem: ${problem ? REPORT_PROBLEMS[problem] : 'Not given'}`,
    details && `Details: ${details}`,
    reportTarget.lonlat && `Location: ${formatLonlat(reportTarget.lonlat)}`,
    `Reported: ${new Date().toLocaleString()}`,
  ].filter(Boolean).join('\n');
}

function reportStatus(text) {
  document.getElementById('report-status').textContent = text;
}

// Copies the report, then opens where it goes. (A pre-filled Google Form, once REPORT_FORM is set.)
async function sendReport(where) {
  const text = reportText();
  if (where === 'form' && REPORT_FORM) {
    const problem = document.querySelector('input[name="report-problem"]:checked')?.value;
    const params = new URLSearchParams({ usp: 'pp_url' });
    const f = REPORT_FORM.fields;
    if (f.about) params.set(f.about, reportTarget.about);
    if (f.problem && problem) params.set(f.problem, REPORT_PROBLEMS[problem]);
    if (f.details) params.set(f.details, document.getElementById('report-details').value.trim());
    if (f.where && reportTarget.lonlat) params.set(f.where, formatLonlat(reportTarget.lonlat));
    window.open(`${REPORT_FORM.url}?${params}`, '_blank', 'noopener');
    return reportStatus('The report form has opened in a new tab, filled in. Check it, then press Submit there.');
  }
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* not allowed: show the text instead */ }
  const textBox = document.getElementById('report-text');
  textBox.value = text;
  textBox.hidden = copied;
  window.open(where === 'facilities' ? UPKEEP_URL : FEEDBACK_FORM, '_blank', 'noopener');
  reportStatus(copied
    ? `Your report is copied. ${where === 'facilities' ? 'BC Facilities' : 'The Access BC feedback form'} has opened in a new tab: paste the report there.`
    : `${where === 'facilities' ? 'BC Facilities' : 'The Access BC feedback form'} has opened in a new tab. Copy the report below and paste it there.`);
}

function closeReport() {
  document.getElementById('report-dialog').hidden = true;
  document.getElementById('report-text').hidden = true;
  // Back to the button that opened it; from the menu (closed now), the menu button
  const back = reportReturnFocus && document.contains(reportReturnFocus) && reportReturnFocus.offsetParent !== null ? reportReturnFocus : null;
  (back || (guide.active ? document.getElementById('guidance-repeat') : document.getElementById('menu-toggle'))).focus();
  // Avoiding something new (or not any more): find the route again, carrying on walking if you were
  if (reportAvoidChanged && routing?.current) {
    if (guide.active) {
      prepareRerouteFromHere();
      Object.assign(routing.autoStart, { intro: 'New route.', keepFocus: true });
    }
    updateRoute(window.map);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('report-dialog');
  document.getElementById('report-problems').innerHTML = Object.entries(REPORT_PROBLEMS).map(([value, label]) =>
    `<div class="setting"><input type="radio" name="report-problem" id="report-problem-${value}" value="${value}"><label for="report-problem-${value}">${label}</label></div>`).join('');
  if (REPORT_FORM) {
    document.getElementById('report-send-facilities').hidden = true;
    document.getElementById('report-send-feedback').hidden = true;
    document.getElementById('report-send-form').hidden = false;
    document.getElementById('report-send-help').textContent = 'Opens the Access BC report form, filled in, for you to check and submit.';
  }

  // Reporting something not working or blocked: avoid it in your routes too (you can uncheck it)
  dialog.addEventListener('change', (e) => {
    const avoid = document.getElementById('report-avoid');
    if (e.target.name === 'report-problem' && ['not-working', 'blocked'].includes(e.target.value) && !document.getElementById('report-avoid-row').hidden && !avoid.checked) {
      avoid.checked = true;
      avoid.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (e.target.id === 'report-avoid' && reportTarget?.layer) {
      setMyReport(reportTarget.layer, reportTarget.id, avoid.checked);
      reportAvoidChanged = true;
      reportStatus(avoid.checked ? `Your routes on this device will avoid it for ${REPORT_DAYS} days.` : 'Your routes will use it again.');
    }
  });
  document.getElementById('report-send-facilities').addEventListener('click', () => sendReport('facilities'));
  document.getElementById('report-send-feedback').addEventListener('click', () => sendReport('feedback'));
  document.getElementById('report-send-form').addEventListener('click', () => sendReport('form'));
  document.getElementById('report-close').addEventListener('click', closeReport);
  document.getElementById('report-done').addEventListener('click', closeReport);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeReport(); }
    if (e.key === 'Tab') { // keep keyboard focus inside the dialog while it's open
      const focusable = [...dialog.querySelectorAll('button, input, textarea, a[href]')].filter((el) => !el.hidden && el.offsetParent !== null);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // "Report a problem" buttons: on map features, in building information, in the menu, and while walking
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-report-layer], [data-report-building], [data-report-here]');
    if (!button || !routing) return;
    if (button.closest('#app-menu')) setMenuOpen(false); // like the menu's other items
    const { reportLayer, reportId, reportBuilding, reportProblem, reportDetails } = button.dataset;
    const preset = { problem: reportProblem, details: reportDetails };
    if (reportLayer) {
      const features = routePoints?.[reportLayer]?.features || [];
      const feature = features.find((f) => String(f.properties[REPORTABLE[reportLayer]]) === reportId);
      if (feature) openReport({ layer: reportLayer, feature, ...preset });
    } else if (reportBuilding) openReport({ building: reportBuilding, ...preset });
    else openReport({ here: true, ...preset });
  });
});
