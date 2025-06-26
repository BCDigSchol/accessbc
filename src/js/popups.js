function addPopupHandlers(map) {
    // Define the layers to add click event handlers
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
            switch (layer) {
                case 'bluelight':
                    popupContent = `<h2>Bluelight</h2><button onclick="window.location.href='https://app.onupkeep.com/#/login/setup-sso?companyId=BostonCollege'">Report issue</button>`;
                    break;
                case 'elevators':
                    popupContent = `<h2>Elevator: ${feature.properties.Building}</h2><button onclick="window.location.href='https://app.onupkeep.com/#/login/setup-sso?companyId=BostonCollege'">Report issue</button>`;
                    break;
                case 'entrances':
                    popupContent = `<h2>Entrance: ${feature.properties.Building}</h2><button onclick="window.location.href='https://app.onupkeep.com/#/login/setup-sso?companyId=BostonCollege'">Report issue</button>`;
                    break;
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
                    popupContent = `<p>${JSON.stringify(feature.properties)}</p>`;
            }

            const popup = new mapboxgl.Popup({ offset: [0, -15] })
                .setLngLat(feature.geometry.coordinates)
                .setHTML(popupContent)
                .addTo(map);
        });

        // Change the cursor to a pointer when the mouse is over the layer.
        map.on('mouseenter', layer, () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        // Change it back to a pointer when it leaves.
        map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
        });
    });
}

function addBuildingHandler(map) {
  // Click event for building features
  map.on('click', 'buildings', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['buildings']
    });

    if (!features.length) {
      return;
    }

    const feature = features[0];
    const buildingName = feature.properties.NAME || 'Unknown Building';
    const description = feature.properties.Description || '';
    
    // Split description by line breaks into an array of lines
    const descriptionLines = description.split('\n');
    
// Map through each line of the description and create a list of paragraphs
const descriptionHtml = descriptionLines.map(line => {
  // Check for specific texts and wrap them in <strong> tags
  if (line.trim() === 'Academic Programs:' || line.trim() === 'Dining Options:' || line.trim() === 'Student Resources:') {
    return `<p><strong>${line.trim()}</strong></p>`;
    }
    return `<p>${line.trim()}</p>`;
}).join('');

    // Build the building popup content
    const buildingInfo = `
      <div class="close" id="building-popup-close">x</div>
      <h2>${buildingName}</h2>
      ${descriptionHtml} <!-- Inject the description with line breaks handled -->
    `;

    // Update the building popup content
    document.getElementById('building-info').innerHTML = buildingInfo;

    // Show the building popup
    document.getElementById('building-popup').classList.add('visible');
  });

  // Hide building popup when user clicks away from the buildings
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['buildings']
    });

    if (!features.length) {
      document.getElementById('building-popup').classList.remove('visible');
    }
  });

  // Hide building popup when the close element is clicked
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'building-popup-close') {
      document.getElementById('building-popup').classList.remove('visible');
    }
  });

  

  // Change the cursor to a pointer when the mouse is over the buildings layer
  map.on('mouseenter', 'buildings', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  // Change it back to the default cursor when it leaves the buildings layer
  map.on('mouseleave', 'buildings', () => {
    map.getCanvas().style.cursor = '';
  });
}
