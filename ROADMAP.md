# Access BC roadmap

What's planned next, and what each item needs. Roughly in priority order within each section.

## Conversations to have

| Who | About |
|---|---|
| **BC Transportation** | **Live shuttle tracker.** Permission to use the live tracker (bostoncollege.transloc.com, run by TransLoc) for arrival times ("next shuttle in 4 min"), ideally through an official GTFS and GTFS-realtime feed from TransLoc (the tracker data already carries GTFS ids). Today Access BC uses a snapshot of the routes and BC's published schedules ([scripts/shuttles.mjs](scripts/shuttles.mjs)). |
| BC Transportation | **Shuttle accessibility.** Which shuttles have wheelchair lifts or ramps, and which stops are accessible (curb, shelter, level boarding). Until then, routes say shuttle accessibility isn't confirmed. Also: is there an accessible van or escort service, and how is it booked? |
| BC Facilities | **Problem reports.** Where reports should go so things get fixed (UpKeep), and whether Access BC's reports can reach them. What data Facilities already has, and in what formats: floor plans, snow priority routes, construction and closures, accessible parking. |
| Disability Services | Which data and features matter most to students; usability testing with students ([docs/usability-testing/](docs/usability-testing/)). |
| Building managers, Auxiliary Services | Building hours, and card-access hours for each entrance. |

## Contributions and live problem reports

- **Built; needs setting up:** the contributions Sheet and its script, the contribute page for volunteers, review and
  verification, and importing verified entries into the data files
  ([setup guide](docs/data-collection/contributions-setup.md)). Public reports go to the Sheet as suggestions.
- Next: "not working" reports (an elevator out, a door broken) through the same Sheet, so everyone's routes avoid what
  others report (today, your own reports affect only your device), expiring after a day or two unless confirmed.
- The same Sheet for other data staff keep up to date: building hours, closures.

## Data to check

- **Entrance links:** 53 links drawn automatically to 49 buildings' entrances: check them on the
  [data review page](review.html) ([or the list](docs/data-collection/entrance-links-to-check.csv), longest first). Check each on the ground, and redraw
  checked ones as real paths. Seven entrance points are drawn well inside their building: where are the doors?
- **Buildings still unreachable:** 9 (Brookline campus buildings, Claver Hall, 214 Beacon Street, 19 Mayflower Rd,
  Haley House), in [buildings-without-accessible-entrance.csv](docs/data-collection/buildings-without-accessible-entrance.csv).

## Getting around

- **Shuttles:** live arrival times (see BC Transportation above); routes that change by day (holidays, football).
- **MBTA Green Line:** stations, live alerts, live train times, and train rides in routes (with schedules by time of
  day and weekend) are in. Next: the MBTA buses at Reservoir and Chestnut Hill.
- **City sidewalks:** 1,432 crossings around campus have no curb information in OpenStreetMap. Tagging curb ramps
  there (`kerb=lowered` on a crossing's end nodes) improves routes after `node scripts/osm-sidewalks.mjs`.
- The Brookline campus has entrances mapped but no paths, in BC's data or OpenStreetMap. Volunteers can map them in
  OpenStreetMap ([guide](docs/data-collection/openstreetmap-mapping-guide.md)), or Facilities may have a site plan
  (it was Pine Manor College) that can be converted.

## Messina College (Brookline campus)

Messina College, BC's two-year college, is on the Brookline campus (400 Heath Street, the former Pine Manor
College). Its 32 buildings and 8 entrances are in Access BC's data, so it's on the map, but:

- **No paths:** walking directions can't go there, or from the shuttle stops to its buildings. Map them in
  OpenStreetMap ([volunteer guide](docs/data-collection/openstreetmap-mapping-guide.md)), or ask Facilities for the
  Pine Manor site plan; then `node scripts/osm-sidewalks.mjs` and `node scripts/link-entrances.mjs`. Once the paths
  are in, shuttle routes (Brookline Campus route) to Messina buildings work automatically.
- **Building names and uses** date from Pine Manor (Administration Building, Library, the Villages…). Update them to
  BC's current names, and add what's in each (Messina offices, classrooms, dining, residence halls) so Where to? and
  Find nearby can find them.
- **Entrances:** check the 8 accessible entrances, and add any that are missing (the [data review page](review.html)
  lists the Brookline buildings with no way to their entrances).
- Messina students may need different things first: residence halls, dining, the shuttle to Chestnut Hill, and
  their advising and academic support offices. Worth asking Messina's staff and students.

## Inside buildings

- Floor levels on indoor paths, and elevators as links between floors ("take the elevator to floor 3").
- Rooms as destinations: single-stall restrooms and lactation rooms with their floor, offices, classrooms.
- Door details: automatic openers (and where the button is), card-swipe doors, heavy doors.
- Source: Facilities' floor plans (CAD or Revit), converted to IMDF. Publish routes and points of interest, not full plans.
- Indoor location: start with steps and landmarks; QR or NFC tags at entrances later.

## Outdoor data

1. Accessible parking and drop-off points.
2. Surface (brick, cobblestone) and cross slope.
3. Crossings: marked crosswalks, accessible pedestrian signals, tactile paving, curb ramp condition.
4. Path width, pinch points, and lighting at night.
5. Snow priority routes.
6. Elevator details: floors served, key needed, hours.
7. Building hours, so routes don't go through buildings that are closed.

## Before relying on live directions

- Time the first load on a few real phones (`tests/accessibility/perf.mjs` slows the processor, but draws the map in
  software, so it overstates map drawing, which a phone's graphics chip does).

- Test with students on real phones (iPhone and Android, with VoiceOver and TalkBack).
- Confirm the accessibility checks run on GitHub's servers ([.github/workflows/accessibility.yml](.github/workflows/accessibility.yml)).
