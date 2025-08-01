//There are 2 types of content in search bar:
// Predefined: based on building attributes fields like dining, single-use restrooms, lactation rooms, etc, which can be associated with multiple buildings.
// Description: based on the building description field, which splits up each named resource in the description field into a separate option in the search bar, associated with only one building

document.addEventListener('DOMContentLoaded', function () {
  // Predefined options added to dropdown
  const predefinedOptions = [
    'Vending Machines', 'Cafes', 'Dining',
    'Lactation Rooms', 'Single-use Restrooms',
    'Group Seating', 'Individual Seating', 'Printing'
  ];

  const searchBar = document.getElementById('generic-search');
  const searchDropdown = document.getElementById('generic-dropdown');

  searchBar.addEventListener('input', function () {
    updateDropdown(this.value);
  });
  searchBar.addEventListener('focus', function () {
    updateDropdown('');
  });

  // Splits building description into individual resources to add to dropdown
  function updateDropdown(query) {
    searchDropdown.innerHTML = '';

    const allFeatures = map.querySourceFeatures('CampusBuildings-5rbg0v', {
      sourceLayer: 'CampusBuildings-5rbg0v'
    });

    const resources = new Set();
    const excludedStrings = [
      'Student Resources:', 'Academic Programs:', 'Dining Options:'
    ];

    allFeatures.forEach(feature => {
      const description = feature.properties.Description || '';
      const resourceList = description.split('\n');
      resourceList.forEach(resource => {
        if (
          !excludedStrings.includes(resource.trim()) &&
          resource.toLowerCase().includes(query.toLowerCase())
        ) {
          resources.add(resource.trim());
        }
      });
    });

    const combinedOptions = [...predefinedOptions, ...resources];
    const filteredOptions = combinedOptions.filter(option =>
      option.toLowerCase().includes(query.toLowerCase())
    );

    if (filteredOptions.length > 0) {
      searchDropdown.style.display = 'block';
      filteredOptions.forEach(option => {
        const div = document.createElement('div');
        div.textContent = option;
        div.addEventListener('click', () => {
          handleSelection(option);
        });
        searchDropdown.appendChild(div);
      });
    } else {
      searchDropdown.style.display = 'none';
    }
  }

  function handleSelection(option) {
    searchBar.value = option;
    searchDropdown.style.display = 'none';
    applyFilter(option);
  }

  document.addEventListener('click', function (event) {
    if (
      !searchBar.contains(event.target) &&
      !searchDropdown.contains(event.target)
    ) {
      searchDropdown.style.display = 'none';
    }
  });
  // Handles filtering to highlight buildings based on the selected option
  function applyFilter(option) {
    let filterField = '';
    switch (option) {
      case 'Lactation Rooms': filterField = 'Lactation'; break;
      case 'Single-use Restrooms': filterField = 'Single_restroom'; break;
      case 'Group Seating': filterField = 'Seating_group'; break;
      case 'Individual Seating': filterField = 'Seating_ind'; break;
      case 'Printing': filterField = 'Printing'; break;
      case 'Vending Machines': filterField = 'Food_vend'; break;
      case 'Cafes': filterField = 'Food_cafe'; break;
      case 'Dining': filterField = 'Food_dining'; break;
      default: handleResourceSelection(option); return;
    }
    // Highlights building if they have 'Yes' for the predefined fields
    map.setFilter('buildings-highlighted', ['==', ['get', filterField], 'Yes']);
    map.setPaintProperty('buildings-highlighted', 'fill-color', [
      'case',
      ['==', ['get', filterField], 'Yes'],
      '#994E95',
      'rgba(0, 0, 0, 0)'
    ]);
    map.setPaintProperty('buildings-highlighted', 'fill-opacity', [
      'case',
      ['==', ['get', filterField], 'Yes'],
      0.75,
      0
    ]);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'visible');
  }
  // Highlights building if the description selected from dropdown is found in the building description field
  function handleResourceSelection(resource) {
    const allFeatures = map.querySourceFeatures('CampusBuildings-5rbg0v', {
      sourceLayer: 'CampusBuildings-5rbg0v'
    });

    const selectedFeature = allFeatures.find(feature => {
      const description = feature.properties.Description || '';
      return description.includes(resource);
    });

    if (selectedFeature) {
      const featureName = selectedFeature.properties.NAME;

      map.setFilter('buildings-highlighted', ['==', ['get', 'NAME'], featureName]);
      map.setPaintProperty('buildings-highlighted', 'fill-color', [
        'case',
        ['==', ['get', 'NAME'], featureName],
        '#994E95',
        'rgba(0, 0, 0, 0)'
      ]);
      map.setPaintProperty('buildings-highlighted', 'fill-opacity', [
        'case',
        ['==', ['get', 'NAME'], featureName],
        0.75,
        0
      ]);

      // Zooms map to the selected buildings (Description field only)
      let coordinates = selectedFeature.geometry.coordinates;
      let bounds = new mapboxgl.LngLatBounds();

      if (selectedFeature.geometry.type === 'Polygon') {
        coordinates[0].forEach(coord => bounds.extend(coord));
      } else if (selectedFeature.geometry.type === 'MultiPolygon') {
        coordinates.forEach(polygon =>
          polygon[0].forEach(coord => bounds.extend(coord))
        );
      }

      map.fitBounds(bounds, { padding: 50, maxZoom: 17 });
      map.setLayoutProperty('buildings-highlighted', 'visibility', 'visible');
    } else {
      map.setFilter('buildings-highlighted', ['==', 'NAME', '']);
      map.setLayoutProperty('buildings-highlighted', 'visibility', 'none');
    }
  }

  //Clears highlighted buildings
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.id = 'searchbar-clear-btn';
  clearBtn.style.marginLeft = '8px';
  clearBtn.type = 'button';
  searchBar.parentNode.insertBefore(clearBtn, searchBar.nextSibling);

  clearBtn.addEventListener('click', function () {
    searchBar.value = '';
    searchDropdown.style.display = 'none';
    map.setFilter('buildings-highlighted', ['==', 'NAME', '']);
    map.setLayoutProperty('buildings-highlighted', 'visibility', 'none');
  });
});


