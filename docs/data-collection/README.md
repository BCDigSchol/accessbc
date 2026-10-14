# Data collection templates

Spreadsheets for BC Facilities and Disability Services to fill in. Each row is an entrance or elevator already on
the map (by `OBJECTID`, building, and coordinates); only the blank columns need answers. They open in Excel or
Google Sheets. Regenerate them after entrances or elevators change (this overwrites any answers, so copy those
out first):

```bash
node scripts/make-data-collection-sheets.mjs
```

Once returned, the answers are merged into `src/geojson/entrances.geojson` and `elevators.geojson` as new
properties, and the app can then show them (automatic doors, intercom-only entrances, audible elevator
announcements, and so on) and use them in routing.
