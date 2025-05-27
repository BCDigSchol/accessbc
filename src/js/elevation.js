let coord0 = null;
let marker1 = null;

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

    console.log("User location:", coord0);

  } catch (err) {
    return; // stop if geolocation fails
  }

  map.on('click', (e) => {
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

      console.log('Line with elevation:', line);

      const elev0Feet = elev0 * 3.28084;
      const elev1Feet = elev1 * 3.28084;
      const elevChangeFeet = elev1Feet - elev0Feet;

      new mapboxgl.Popup()
        .setLngLat(coord1)
        .setHTML(
          `Start Elev: ${elev0Feet.toFixed(2)} ft<br>` +
          `End Elev: ${elev1Feet.toFixed(2)} ft<br>` +
          `Change: ${elevChangeFeet.toFixed(2)} ft`
        )
        .addTo(map);

    } catch (err) {
      console.error("Error querying elevation:", err);
    }
  });
}
