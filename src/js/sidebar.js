// sidebar.js

function addSidebarHandlers(map) {
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
      const vending = feature.properties.Food_vend === 'Yes' ? 'Vending machines' : '';
      const lactation = feature.properties.Lactation === 'Yes' ? 'Lactation room' : '';
      const printing = feature.properties.Printing === 'Yes' ? 'Printing stations' : '';
      const restrooms = feature.properties.Single_restroom === 'Yes' ? 'Single-use Restrooms' : '';
  
      // Build the sidebar content
      const buildingInfo = `
        <h2>${buildingName}</h2>
        <p>${description}</p>
        <p>Other Resources:</p>
        <p>${vending}</p>
        <p>${lactation}</p>
        <p>${printing}</p>
        <p>${restrooms}</p>
      `;
  
      // Update the sidebar content
      document.getElementById('building-info').innerHTML = buildingInfo;
  
      // Show the sidebar
      document.getElementById('sidebar').classList.add('visible');
    });
  
    // Hide sidebar when user clicks away from the buildings
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['buildings']
      });
  
      if (!features.length) {
        document.getElementById('sidebar').classList.remove('visible');
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
  