//Sets up elevation container in the legend to display elevation information. Handlers toggling to turn elevation functionality on and off.
function createElevationLegend(containerId) {
    if (document.getElementById('legend-elevation-section')) return;
    
    const legendContainer = document.getElementById(containerId);
    const elevSection = document.createElement('div');
    elevSection.classList.add('legend-section');
    elevSection.id = 'legend-elevation-section';

    const elevHeader = document.createElement('h3');
    elevHeader.classList.add('legend-subheader');
    const elevToggle = document.createElement('button');
    elevToggle.type = 'button';
    elevToggle.classList.add('legend-category-toggle');
    elevToggle.setAttribute('aria-expanded', 'false');
    elevToggle.setAttribute('aria-controls', 'elevation-content');
    elevToggle.innerHTML = '<span class="legend-category-label">Elevation</span><span class="legend-arrow" aria-hidden="true">►</span>';
    const elevToggleSpan = elevToggle.querySelector('.legend-arrow');
    elevHeader.appendChild(elevToggle);

    elevSection.appendChild(elevHeader);

    const elevContent = document.createElement('div');
    elevContent.classList.add('legend-category-content', 'collapsed');
    elevContent.id = 'elevation-content';
    elevContent.style.maxHeight = '0';
    elevContent.style.overflow = 'hidden';

    const elevInfo = document.createElement('div');
    elevInfo.id = 'elevation-info';
    elevInfo.style.fontSize = '0.9rem';
    elevInfo.style.color = '#444';
    elevInfo.style.padding = '0.5rem 0';
    elevInfo.setAttribute('aria-live', 'polite');
    elevInfo.innerHTML = 'Click on the map to get elevation change.';
    elevContent.appendChild(elevInfo);

    elevSection.appendChild(elevContent);
    legendContainer.appendChild(elevSection);

    const toggleElevation = () => {
        const isCollapsed = elevContent.classList.toggle('collapsed');
        elevContent.style.maxHeight = isCollapsed ? '0' : 'none';
        elevToggleSpan.textContent = isCollapsed ? '►' : '▼';
        elevToggle.setAttribute('aria-expanded', String(!isCollapsed));
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

    elevToggle.addEventListener('click', toggleElevation);
}
// Sets up coordinate variables for elevation handler
let coord0 = null;
let marker1 = null;
let elevationActive = false;

//Grabs user's current location
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
        alert("It looks like your geolocation is turned off. Please turn it on for all of the functions in this app to work.");
        reject(error);
      }
    );
  });
}

// Queries elevation data when the user clicks on the map and calculates change between user location and selected
async function setupElevationHandler(map) {
  try {
    coord0 = await getUserLocation();

    if (!Array.isArray(coord0) || coord0.length !== 2 || isNaN(coord0[0]) || isNaN(coord0[1])) {
      console.error("Invalid coord0:", coord0);
      alert("Could not determine valid user location.");
      return;
    }

  } catch (err) {
    return; 
  }

  map.on('click', (e) => {
    if (!elevationActive) return;
    if (!coord0 || isNaN(coord0[0]) || isNaN(coord0[1])) {
      alert("User location not set. Try refreshing.");
      return;
    }

    const coord1 = [e.lngLat.lng, e.lngLat.lat];

    if (marker1) marker1.remove();

    marker1 = new maplibregl.Marker({ color: '#ed6461' })
      .setLngLat(coord1)
      .addTo(map);

    try {
      if (!map.isSourceLoaded('terrain')) {
        console.warn('DEM source not loaded yet. Cannot query elevation.');
        return;
      }

      // Query elevation using geographic coordinates (LngLat)
      const elev0 = map.queryTerrainElevation(coord0);
      const elev1 = map.queryTerrainElevation(coord1);

      if (elev0 == null || elev1 == null) {
        console.warn("Elevation data unavailable at one or both points.");
        return;
      }

      const elev0Feet = elev0 * 3.28084;
      const elev1Feet = elev1 * 3.28084;
      const elevChangeFeet = elev1Feet - elev0Feet;

      const elevInfoContainer = document.getElementById('elevation-info');
      if (elevInfoContainer) {
        elevInfoContainer.innerHTML = 
          `Current Elevation: ${elev0Feet.toFixed(2)} ft<br>` +
          `Destination Elevation: ${elev1Feet.toFixed(2)} ft<br>` +
          `Change: ${elevChangeFeet.toFixed(2)} ft`;
      }

    } catch (err) {
      console.error("Error querying elevation:", err);
    }
  });
}
