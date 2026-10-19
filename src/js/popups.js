// Handles popups for bluelight, elevators, entrances, and shuttle stops features to display information and provide issue reporting options.
function addPopupHandlers(map) {
   const layers = ['bluelight', 'elevators', 'entrances', 'shuttlestop'];

    layers.forEach(layer => {
        // Add click event for each layer to display attributes
        map.on('click', layer, (e) => {
            const features = map.queryRenderedFeatures(e.point, {
                layers: [layer]
            });

            if (!features.length) {
                return;
            }

            const feature = features[0];
            let popupContent = '';

            // Customize popup content based on the layer
            // Elevators, entrances and blue-light phones: what it is, whether it's reported not working, and
            // Report a problem (reports.js)
            const source = { bluelight: 'bluelights', elevators: 'elevators', entrances: 'entrances' }[layer];
            if (source) {
                const name = featureName(source, feature);
                const id = feature.properties[REPORTABLE[source]];
                popupContent = `<h2>${escapeText(name)}</h2>
                  ${isReportedBroken(feature) ? '<p><strong>Reported not working.</strong></p>' : ''}
                  ${source === 'bluelights' ? `${emergencyCallLinks()}<button type="button" data-place-directions="${feature.geometry.coordinates.join(',')}" data-label="${escapeText(name.replace('Blue-light emergency phone', 'Blue-light phone'))}">Directions here</button>` : ''}
                  <button type="button" data-report-layer="${source}" data-report-id="${escapeText(String(id))}">Report a problem</button>`;
            }
            switch (layer) {
                case 'shuttlestop': {
                    // The stop, its routes (filled in below: running now, or when next), and Directions here
                    const p = feature.properties, name = p.Name || 'Shuttle stop';
                    popupContent = `<h2>${escapeText(name)} shuttle stop</h2>
                      <ul class="popup-routes">${(p.Routes || '').split('; ').filter(Boolean).map((r) => `<li data-shuttle-route="${escapeText(r)}"><strong>${escapeText(r)}</strong></li>`).join('')}</ul>
                      ${p.Sheltered === 'Yes' ? `<p>Sheltered${p.Heater === 'Yes' ? ', heated' : ''}.</p>` : ''}
                      <p>Shuttle lift or ramp access isn’t confirmed.</p>
                      <button type="button" data-place-directions="${feature.geometry.coordinates.join(',')}" data-label="${escapeText(`${name} shuttle stop`)}">Directions here</button>
                      <a href="https://bostoncollege.transloc.com/" target="_blank" rel="noopener">Live shuttle tracker</a>`;
                    break;
                }
                default:
                    if (!popupContent) popupContent = `<p>${escapeText(JSON.stringify(feature.properties))}</p>`;
            }
            // Set popup on the selected feature
            const popup = new maplibregl.Popup({ offset: [0, -15] })
                .setLngLat(feature.geometry.coordinates)
                .setHTML(popupContent)
                .addTo(map);
            if (layer === 'shuttlestop') fillShuttleTimes(popup.getElement());
        });
        // Mouse cursor styling
        map.on('mouseenter', layer, () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
        });
    });
}

// Each route at a shuttle stop popup: running now (and how often), or when it next runs
async function fillShuttleTimes(element) {
  const data = await loadShuttles();
  if (!data || !routing?.transit) return;
  const { runningService, nextService, clockTime } = routing.transit;
  element.querySelectorAll('[data-shuttle-route]').forEach((li) => {
    const route = data.routes.find((r) => r.name === li.dataset.shuttleRoute);
    if (!route) return;
    const now = runningService(route), next = !now && nextService(route);
    const when = next && (next.dayOffset === 0 ? 'today' : next.dayOffset === 1 ? 'tomorrow' : `on ${new Date(Date.now() + next.dayOffset * 864e5).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })}`);
    li.append(now ? `: running now, about every ${now.every} min` : next ? `: next runs ${when} from ${clockTime(next.from)}` : ': not running this week');
  });
}

// A building directions can't go to: either no accessible entrance is mapped, or its entrance isn't connected to the
// mapped paths. Either way, students can say where it is or how to reach it.
function missingEntranceHtml(buildingName) {
  const onMap = typeof buildingOf === 'function' && (routePoints?.entrances?.features || []).some((f) => buildingOf(f) === buildingName);
  const [note, ask, details] = onMap
    ? ["Its accessible entrance isn't connected to the mapped paths yet, so directions can't go here.", 'Tell us how to reach its accessible entrance', 'How to reach its accessible entrance from the nearest path: ']
    : ["No accessible entrance is mapped for this building yet, so directions can't go here.", 'Tell us where its accessible entrance is', 'Where its accessible entrance is: '];
  return `<p class="route-note">${note}</p>
    <p><button type="button" class="report-link" data-report-building="${escapeText(buildingName)}" data-report-problem="map" data-report-details="${escapeText(details)}">${ask}</button></p>`;
}

// Building information dialog. Opened by clicking a building on the map, or by picking a building in the
// search box (so it's reachable without the map). Focus moves into it, Escape closes it, and focus returns
// to wherever it was before.
let buildingInfoReturnFocus = null;
const escapeText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function openBuildingInfo(properties) {
  const buildingName = (properties.NAME || '').trim() || 'Unknown Building';
  const description = properties.Descriptio || '';

  // Each description line becomes a paragraph; the section headers are bold
  const headers = ['Academic Programs:', 'Dining Options:', 'Student Resources:'];
  const descriptionHtml = description.split('\n').map(line => line.trim()).filter(Boolean).map(line =>
    headers.includes(line) ? `<p><strong>${escapeText(line)}</strong></p>` : `<p>${escapeText(line)}</p>`
  ).join('');

  // Directions buttons, only for buildings with an accessible entrance on the path network
  const directionsHtml = isRoutable(buildingName) ? `
    <div class="popup-directions">
      <button type="button" data-route-from="${escapeText(buildingName)}">Directions from here</button>
      <button type="button" data-route-to="${escapeText(buildingName)}">Directions to here</button>
    </div>` : missingEntranceHtml(buildingName);

  document.getElementById('building-info').innerHTML = `
    <button type="button" class="close" id="building-popup-close" aria-label="Close building information">×</button>
    <h2 id="building-name">${escapeText(buildingName)}</h2>
    ${descriptionHtml}
    ${typeof buildingSurroundingsHtml === 'function' ? buildingSurroundingsHtml(buildingName) : ''}
    ${directionsHtml}
    <p><button type="button" class="report-link" data-report-building="${escapeText(buildingName)}">Report a problem with this building</button></p>
  `;
  const popup = document.getElementById('building-popup');
  if (!popup.classList.contains('visible')) buildingInfoReturnFocus = document.activeElement;
  popup.classList.add('visible');
  document.getElementById('building-popup-close').focus();
}

function closeBuildingInfo() {
  const popup = document.getElementById('building-popup');
  if (!popup.classList.contains('visible')) return;
  popup.classList.remove('visible');
  if (buildingInfoReturnFocus && document.contains(buildingInfoReturnFocus)) buildingInfoReturnFocus.focus();
  buildingInfoReturnFocus = null;
}

// Handles popups for building to display building description
function addBuildingHandler(map) {
  map.on('click', 'buildings', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['buildings'] });
    if (features.length) openBuildingInfo(features[0].properties);
  });

  // Hide building popup when user clicks away from the buildings
  map.on('click', (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: ['buildings'] }).length) closeBuildingInfo();
  });

  // Hide building popup when the close button is clicked, or Escape is pressed
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'building-popup-close') closeBuildingInfo();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBuildingInfo();
  });
  // Mouse cursor styling
  map.on('mouseenter', 'buildings', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'buildings', () => {
    map.getCanvas().style.cursor = '';
  });
}
