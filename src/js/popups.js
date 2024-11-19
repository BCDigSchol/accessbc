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
