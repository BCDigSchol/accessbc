function addMapData(map) {
  return new Promise((resolve) => {
    map.addSource('bikerack-5yn5u5', {
        'type': 'vector',
        'url': 'mapbox://bcdsg-lec.35wuf8yc'
      });
      map.addSource('bluelight-8tahas', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.2v8mtky1'
      });
      map.addSource('elevators-17pm1x',{
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.9zp1t3fm'
      });
      map.addSource('entrances-6v95tt', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.cf8ep7jl' 
      });
      map.addSource('curbcuts-5wa67q', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.9fpimwx2'
      });
      map.addSource('reststop', {
          'type': 'geojson',
          'data': 'src/geojson/reststop.geojson',
          'cluster': true,
          'clusterMaxZoom': 25,
          'clusterRadius': 20
      })
      map.addSource('shuttlestop-3opjnk', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.b0eg11k3'
      });
      map.addSource('paths_cleaned-1iqegh', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.6wha4sxm'
      });
      map.addSource('buildings-3cknrt', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.c2z0cfaj'
      });
      map.addSource('accessiblepaths-b55sh1', {
          'type': 'vector',
          'url': 'mapbox://bcdsg-lec.ctxmzxxp'
      });
      map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 20
      });
      map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1 });

    
      
    map.addLayer({
      id: 'buildings',
      type: 'fill',
      source: 'buildings-3cknrt',
      'source-layer': 'buildings-3cknrt',
      layout: {},
      paint: {
        'fill-color': '#2C7FB8',
        'fill-opacity': 0.3
      }
    });
    map.addLayer({
        id: 'paths',
        type: 'line',
        source: 'paths_cleaned-1iqegh',
        'source-layer': 'paths_cleaned-1iqegh',
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
      source: 'accessiblepaths-b55sh1',
      'source-layer': 'accessiblepaths-b55sh1',
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
      source: 'accessiblepaths-b55sh1',
      'source-layer': 'accessiblepaths-b55sh1',
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
    map.loadImage('src/icons/bike.png', function(error, image) {
        if (error) throw error;
      map.addImage('bike-icon', image);
      map.addLayer({
        id: 'bikerack',
        type: 'symbol',
        source: 'bikerack-5yn5u5',
        'source-layer': 'bikerack-5yn5u5',
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
        source: 'bluelight-8tahas',
        'source-layer': 'bluelight-8tahas',
        layout: {},
        paint: {
          'circle-radius': 5,
          'circle-color': '#0000ff',
        }
      });

      map.addLayer({
        id: 'elevators',
        type: 'circle',
        source: 'elevators-17pm1x',
        'source-layer': 'elevators-17pm1x',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': '#94346E',
        }
      });

      map.addLayer({
        id: 'entrances',
        type: 'circle',
        source: 'entrances-6v95tt',
        'source-layer': 'entrances-6v95tt',
        layout: {},
        paint: {
          'circle-radius': 4,
          'circle-color': '#f97b72',
        }
      });

      map.addLayer({
        id: 'curbcuts',
        type: 'circle',
        source: 'curbcuts-5wa67q',
        'source-layer': 'curbcuts-5wa67q',
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

      map.loadImage('src/icons/shuttle.png', function(error, image) {
        if (error) throw error;
      map.addImage('shuttle-icon', image);
      map.addLayer({
        id: 'shuttlestop',
        type: 'symbol',
        source: 'shuttlestop-3opjnk',
        'source-layer': 'shuttlestop-3opjnk',
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
      source: 'buildings-3cknrt',
      'source-layer': 'buildings-3cknrt',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'fieldName'], 'Yes'], // fieldName is a placeholder, will be set dynamically
          '#994E95',
          ['==', ['get', 'NAME'], 'Garage'],
          '#994E95',
          'rgba(0, 0, 0, 0)'
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'fieldName'], 'Yes'],
          0.75,
          ['==', ['get', 'NAME'], 'Garage'],
          0.75,
          0
        ]
      }
    });
  });
}