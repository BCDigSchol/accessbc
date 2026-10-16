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
                  ${source === 'bluelights' ? `${emergencyCallLinks()}<button type="button" data-bluelight-directions="${feature.geometry.coordinates.join(',')}" data-label="${escapeText(name.replace('Blue-light emergency phone', 'Blue-light phone'))}">Directions here</button>` : ''}
                  <button type="button" data-report-layer="${source}" data-report-id="${escapeText(String(id))}">Report a problem</button>`;
            }
            switch (layer) {
                case 'shuttlestop':
                    let listItems = '';
                    if (feature.properties.Express === 'Yes') {
                        listItems += `<li>Express</li>`;
                    }
                    if (feature.properties.All_Stop === 'Yes') {
                        listItems += `<li>All Stop</li>`;
                    }
                    if (feature.properties.Commonwealth === 'Yes') {
                        listItems += `<li>Commonwealth</li>`;
                    }
                    popupContent = `<h2>Shuttle Routes:</h2><p>${listItems}</p><button onclick="window.location.href='https://bostoncollege.transloc.com/routes'">Live Shuttle Tracker</button>`;
                    break;
                default:
                    if (!popupContent) popupContent = `<p>${escapeText(JSON.stringify(feature.properties))}</p>`;
            }
            // Set popup on the selected feature
            const popup = new maplibregl.Popup({ offset: [0, -15] })
                .setLngLat(feature.geometry.coordinates)
                .setHTML(popupContent)
                .addTo(map);
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
    </div>` : '';

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
