let coord0 = null;
let marker1 = null;
let geolocationReady = false;

function lngLatToTile(lng, lat, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
  return { x, y };
}

function lngLatToPixelInTile(lng, lat, zoom) {
  const scale = Math.pow(2, zoom) * 512; // terrain tile size
  const worldCoordinateX = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const worldCoordinateY = ((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))) * scale;

  const pixelX = Math.floor(worldCoordinateX % 512);
  const pixelY = Math.floor(worldCoordinateY % 512);
  return { x: pixelX, y: pixelY };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // CORS must be allowed
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load error'));
    img.src = url;
  });
}

function getRGBFromImage(img, x, y) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const pixelData = ctx.getImageData(x, y, 1, 1).data;
  return { r: pixelData[0], g: pixelData[1], b: pixelData[2] };
}

async function getElevationFromTerrainRGB(lng, lat) {
  const zoom = 15;
  const tile = lngLatToTile(lng, lat, zoom);
  const pixel = lngLatToPixelInTile(lng, lat, zoom);

  const tileUrl = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${tile.x}/${tile.y}@2x.pngraw?access_token=${mapboxgl.accessToken}`;

  const img = await loadImage(tileUrl);

  const { r, g, b } = getRGBFromImage(img, pixel.x * 2, pixel.y * 2); 
  // multiply by 2 for @2x tile pixel coords

  const elevation = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);

  return elevation;
}

function setupElevationHandler(map) {
  navigator.geolocation.getCurrentPosition(
    position => {
      coord0 = [position.coords.longitude, position.coords.latitude];
      geolocationReady = true;
    },
    error => {
      console.error("Geolocation error:", error.message);
      alert("Geolocation not available or permission denied.");
    }
  );

  map.on('click', async (e) => {
    if (!geolocationReady) {
      alert("Waiting for geolocation...");
      return;
    }

    const coord1 = [e.lngLat.lng, e.lngLat.lat];
    if (marker1) marker1.remove();

    marker1 = new mapboxgl.Marker({ color: '#ed6461' })
      .setLngLat(coord1)
      .addTo(map);

    try {
      const [elev0, elev1] = await Promise.all([
        getElevationFromTerrainRGB(coord0[0], coord0[1]),
        getElevationFromTerrainRGB(coord1[0], coord1[1])
      ]);

      const elevChange = elev1 - elev0;
      const line = turf.lineString([coord0, coord1], {
        elevation_start: elev0,
        elevation_end: elev1,
        elevation_change: elevChange
      });

      console.log('Line with elevation:', line);
    } catch (err) {
      console.error("Elevation fetch failed:", err);
    }
  });
}