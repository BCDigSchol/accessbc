# Data collection templates

Spreadsheets for BC Facilities and Disability Services to fill in. Each row is an entrance or elevator already on
the map (by `OBJECTID`, building, and coordinates); only the blank columns need answers. They open in Excel or
Google Sheets. Regenerate them after entrances or elevators change (this overwrites any answers, so copy those
out first):

```bash
node scripts/make-data-collection-sheets.mjs
```

`buildings-without-accessible-entrance.csv` lists the buildings directions can't go to yet, because no accessible
entrance is linked to the paths: most important first (buildings with restrooms, food, printing or seating, then
those with listed resources). *What is missing* says which kind of gap it is: **no accessible entrance mapped** (someone
needs to look at the building), or **entrance mapped, not connected to a path** (the entrance is on the map, but
more than 15 m from any path: drawing the path to it in `accessiblepaths.geojson` is enough).

Once returned, the answers are merged into `src/geojson/entrances.geojson` and `elevators.geojson` as new
properties, and the app can then show them (automatic doors, intercom-only entrances, audible elevator
announcements, and so on) and use them in routing.
