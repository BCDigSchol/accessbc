function addMapData(map) {
  return new Promise((resolve) => {
   // Load data sources from the GeoJSON files in src/geojson
    ['bikeracks', 'bluelights', 'elevators', 'entrances', 'curbcuts', 'shuttlestops',
     'paths', 'buildings', 'accessiblepaths'].forEach(name => {
      map.addSource(name, {
          'type': 'geojson',
          'data': `src/geojson/${name}.geojson`
      });
    });
      map.addSource('reststop', {
          'type': 'geojson',
          'data': 'src/geojson/reststop.geojson',
          'cluster': true,
          'clusterMaxZoom': 17, // must be below the source's maxzoom (18); seats show individually when zoomed in
          'clusterRadius': 20
      })
      map.addSource('terrain', {
          type: 'raster-dem',
          url: 'pmtiles://' + new URL('src/basemap/terrain.pmtiles', document.baseURI).href,
          encoding: 'terrarium',
          tileSize: 256
      });
      map.setTerrain({ 'source': 'terrain', 'exaggeration': 1 });

    // Add layers to map and set styling  
    map.addLayer({
      id: 'buildings',
      type: 'fill',
      source: 'buildings',
      layout: {},
      paint: {
        'fill-color': '#2C7FB8',
        'fill-opacity': 0.3
      }
    });
    map.addLayer({
        id: 'paths',
        type: 'line',
        source: 'paths',
        layout: {},
        paint: {
          'line-color': '#F2B701',
          'line-width': 3,
        }
      });
    map.setFilter('paths', ['==', ['get', 'highway'], 'steps']);
    map.addLayer({
      id: 'accessiblepaths-int',
      type: 'line',
      source: 'accessiblepaths',
      layout: {},
      paint: {
      'line-color': [
        'case',
        ['==', ['get', 'Type'], 'Exterior'],
        '#0F8554', 
        ['==', ['get', 'Type'], 'Interior'],
        '#5F4690', 
        '#000000' 
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'Type'], 'Exterior'],
        0, 
        ['==', ['get', 'Type'], 'Interior'],
        1, 
        1
      ],
      'line-width': 2
      }
    });
    
    map.addLayer({
      id: 'accessiblepaths-ext',
      type: 'line',
      source: 'accessiblepaths',
      layout: {},
      paint: {
      'line-color': [
        'case',
        ['==', ['get', 'Type'], 'Exterior'],
        '#0F8554', 
        ['==', ['get', 'Type'], 'Interior'],
        '#5F4690', 
        '#000000' 
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'Type'], 'Exterior'],
        1, 
        ['==', ['get', 'Type'], 'Interior'],
        0, 
        1
      ],
      'line-width': 2
      }
    });
    map.loadImage('src/icons/bike.png').then(({ data: image }) => {
      map.addImage('bike-icon', image);
      map.addLayer({
        id: 'bikerack',
        type: 'symbol',
        source: 'bikeracks',
        'layout': {},
        layout: {
          'icon-image': 'bike-icon',
          'icon-size': 0.2
        }
      });
      applyMapSettings(map); // icon size follows the bigger-symbols setting
    });

      map.addLayer({
        id: 'bluelight',
        type: 'circle',
        source: 'bluelights',
        layout: {},
        paint: {
          'circle-radius': 5,
          'circle-color': reportedOr('#0000ff', '#8a8a8a'),
        }
      });

      map.addLayer({
        id: 'elevators',
        type: 'circle',
        source: 'elevators',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': reportedOr('#94346E', '#8a8a8a'),
        }
      });

      map.addLayer({
        id: 'entrances',
        type: 'circle',
        source: 'entrances',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': reportedOr('#f97b72', '#8a8a8a'),
        }
      });

      map.addLayer({
        id: 'curbcuts',
        type: 'circle',
        source: 'curbcuts',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': '#3969AC',
          'circle-opacity': 0.7
        }
      });

      map.addLayer({
        id: 'reststop',
        type: 'circle',
        source: 'reststop',
        paint: {
          'circle-color': '#73AF48',
          'circle-radius': 5
        }
      });

      map.loadImage('src/icons/shuttle.png').then(({ data: image }) => {
      map.addImage('shuttle-icon', image);
      map.addLayer({
        id: 'shuttlestop',
        type: 'symbol',
        source: 'shuttlestops',
        'layout': {},
        layout: {
          'icon-image': 'shuttle-icon',
          'icon-size': 0.04
        }
      });
      applyMapSettings(map); // icon size follows the bigger-symbols setting
    });

    map.addLayer({
      id: 'buildings-highlighted',
      type: 'fill',
      source: 'buildings',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'fieldName'], 'Yes'], // fieldName is a placeholder for the fields with building information
          '#994E95',
          'rgba(0, 0, 0, 0)'
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'fieldName'], 'Yes'],
          0.75,
          0
        ]
      }
    });

    // 3D buildings, shown when the map is tilted (see the 3D control in mapcontrols.js). Heights were
    // measured from USGS lidar by scripts/lidar/derive-building-heights.py; small sheds without one get 3 m.
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: 'buildings',
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': '#2C7FB8',
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 3],
        'fill-extrusion-opacity': 0.75
      }
    });

    addBuildingLabels(map);
  });
}

// Building name labels, shown when zoomed in. Larger buildings win when labels collide, so more names
// appear as you zoom closer.
function addBuildingLabels(map) {
  fetch('src/geojson/buildings.geojson').then(r => r.json()).then(data => {
    const features = data.features
      .filter(f => (f.properties.NAME || '').trim())
      .map(f => {
        const { point, area } = labelPoint(f.geometry);
        return { type: 'Feature', properties: { name: f.properties.NAME.trim(), area }, geometry: { type: 'Point', coordinates: point } };
      });
    map.addSource('building-labels', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: 'building-labels',
      type: 'symbol',
      source: 'building-labels',
      minzoom: 15.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 11, 19, 15],
        'text-max-width': 8,
        'text-padding': 4,
        'symbol-sort-key': ['-', ['get', 'area']]
      },
      paint: {
        'text-color': '#1b1b1b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6
      }
    });
    applyMapSettings(map);
  });
}

// A label point well inside a (Multi)Polygon footprint, so labels don't land outside L-shaped or courtyard
// buildings: of a grid of candidate points inside the largest polygon, the one farthest from its edges.
function labelPoint(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const k = Math.cos(42.335 * Math.PI / 180); // longitude degrees are shorter than latitude degrees here
  const area = (ring) => Math.abs(ring.reduce((s, p, i) => (i ? s + (ring[i - 1][0] * p[1] - p[0] * ring[i - 1][1]) : 0), 0) / 2) * k * 111320 * 111320;
  const polygon = polygons.reduce((best, p) => (area(p[0]) > area(best[0]) ? p : best));
  const inside = ([x, y]) => polygon.reduce((c, ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }, false);
  const edgeDistance = ([x, y]) => {
    let d = Infinity;
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
        const dx = (bx - ax) * k, dy = by - ay, px = (x - ax) * k, py = y - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(px - t * dx, py - t * dy));
      }
    return d;
  };
  const xs = polygon[0].map(p => p[0]), ys = polygon[0].map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = { point: [(x0 + x1) / 2, (y0 + y1) / 2], d: -1 };
  const n = 15;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const p = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
      if (!inside(p)) continue;
      const d = edgeDistance(p);
      if (d > best.d) best = { point: p, d };
    }
  return { point: best.point, area: Math.round(polygons.reduce((s, p) => s + area(p[0]), 0)) };
}