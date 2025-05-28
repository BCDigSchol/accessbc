function createElevationLegend(containerId) {
    if (document.getElementById('legend-elevation-section')) return;
    
    const legendContainer = document.getElementById(containerId);
    const elevSection = document.createElement('div');
    elevSection.classList.add('legend-section');
    elevSection.id = 'legend-elevation-section';

    // Header with toggle
    const elevHeader = document.createElement('h4');
    elevHeader.classList.add('legend-subheader');

    const elevToggleSpan = document.createElement('span');
    elevToggleSpan.textContent = '►'; // collapsed by default
    elevToggleSpan.style.marginLeft = '0.5rem';
    elevToggleSpan.style.cursor = 'pointer';

    const elevHeaderLabel = document.createElement('span');
    elevHeaderLabel.textContent = 'Elevation';
    elevHeaderLabel.classList.add('legend-category-label');
    elevHeaderLabel.style.cursor = 'pointer';
    elevHeaderLabel.style.fontWeight = 'bold';

    elevHeader.textContent = '';
    elevHeader.appendChild(elevHeaderLabel);
    elevHeader.appendChild(elevToggleSpan);

    elevSection.appendChild(elevHeader);

    const elevContent = document.createElement('div');
    elevContent.classList.add('legend-category-content', 'collapsed');
    elevContent.style.maxHeight = '0';
    elevContent.style.overflow = 'hidden';

    const elevInfo = document.createElement('div');
    elevInfo.id = 'elevation-info';
    elevInfo.style.fontSize = '0.9rem';
    elevInfo.style.color = '#444';
    elevInfo.style.padding = '0.5rem 0';
    elevInfo.innerHTML = 'Click on the map to get elevation change.';
    elevContent.appendChild(elevInfo);

    elevSection.appendChild(elevContent);
    legendContainer.appendChild(elevSection);

    // Toggle
    const toggleElevation = () => {
        const isCollapsed = elevContent.classList.toggle('collapsed');
        elevContent.style.maxHeight = isCollapsed ? '0' : 'none';
        elevToggleSpan.textContent = isCollapsed ? '►' : '▼';
        elevationActive = !isCollapsed;
        if (isCollapsed && marker1) {
        marker1.remove();
        marker1 = null;

        const elevInfoContainer = document.getElementById('elevation-info');
        if (elevInfoContainer) {
            elevInfoContainer.innerHTML = 'Click on the map to get elevation change.';
        }
    }
    };

    elevHeader.addEventListener('click', toggleElevation);
    elevToggleSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleElevation();
    });

    
}

let coord0 = null;
let marker1 = null;
let elevationActive = false;

async function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported by your browser");
      reject("No geolocation support");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const coords = [position.coords.longitude, position.coords.latitude];
        resolve(coords);
      },
      error => {
        console.error("Geolocation error:", error.message);
        alert("Geolocation not available or permission denied.");
        reject(error);
      }
    );
  });
}

async function setupElevationHandler(map) {
  try {
    coord0 = await getUserLocation();

    if (!Array.isArray(coord0) || coord0.length !== 2 || isNaN(coord0[0]) || isNaN(coord0[1])) {
      console.error("Invalid coord0:", coord0);
      alert("Could not determine valid user location.");
      return;
    }

  } catch (err) {
    return; // stop if geolocation fails
  }

  map.on('click', (e) => {
    if (!elevationActive) return;
    if (!coord0 || isNaN(coord0[0]) || isNaN(coord0[1])) {
      alert("User location not set. Try refreshing.");
      return;
    }

    const coord1 = [e.lngLat.lng, e.lngLat.lat];

    if (marker1) marker1.remove();

    marker1 = new mapboxgl.Marker({ color: '#ed6461' })
      .setLngLat(coord1)
      .addTo(map);

    try {
      if (!map.isSourceLoaded('mapbox-dem')) {
        console.warn('DEM source not loaded yet. Cannot query elevation.');
        return;
      }

      // Query elevation using geographic coordinates (LngLat)
      const elev0 = map.queryTerrainElevation(coord0, { exaggerated: false });
      const elev1 = map.queryTerrainElevation(coord1, { exaggerated: false });

      if (elev0 == null || elev1 == null) {
        console.warn("Elevation data unavailable at one or both points.");
        return;
      }

      const elevChange = elev1 - elev0;

      // Create a Turf.js line with elevation info as properties
      const line = turf.lineString([coord0, coord1], {
        elevation_start: elev0,
        elevation_end: elev1,
        elevation_change: elevChange
      });

      const elev0Feet = elev0 * 3.28084;
      const elev1Feet = elev1 * 3.28084;
      const elevChangeFeet = elev1Feet - elev0Feet;

      const elevInfoContainer = document.getElementById('elevation-info');
      if (elevInfoContainer) {
        elevInfoContainer.innerHTML = 
          `Start Elevation: ${elev0Feet.toFixed(2)} ft<br>` +
          `End Elevation: ${elev1Feet.toFixed(2)} ft<br>` +
          `Change: ${elevChangeFeet.toFixed(2)} ft`;
      }

    } catch (err) {
      console.error("Error querying elevation:", err);
    }
  });
}
