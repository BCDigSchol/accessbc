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
          'clusterMaxZoom': 25,
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
    });

      map.addLayer({
        id: 'bluelight',
        type: 'circle',
        source: 'bluelights',
        layout: {},
        paint: {
          'circle-radius': 5,
          'circle-color': '#0000ff',
        }
      });

      map.addLayer({
        id: 'elevators',
        type: 'circle',
        source: 'elevators',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': '#94346E',
        }
      });

      map.addLayer({
        id: 'entrances',
        type: 'circle',
        source: 'entrances',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': '#f97b72',
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
        filter: ['has', 'point_count'],
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
  });
}