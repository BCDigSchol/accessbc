# Mapping accessible paths in OpenStreetMap: a volunteer guide

Access BC can only give directions along paths it knows about. On the Brookline campus, no walkways are mapped yet,
in BC's data or in [OpenStreetMap](https://www.openstreetmap.org) (OSM), the free map of the world that Access BC
uses for city sidewalks. Adding them to OSM means Access BC can route there, and so can every other map app that
uses OSM.

You'll walk the campus, noting what matters for accessibility, and then draw the paths in OSM's online editor.
Allow about two hours for the walk and two for the drawing. No experience is needed.

## Before you start

- **Make an OSM account** at [openstreetmap.org](https://www.openstreetmap.org/user/new), and try the editor's
  built-in walkthrough (it opens the first time you choose **Edit**). It takes 15 minutes.
- **Map only what you've seen, or what you can see on the editor's aerial photos.** Never copy from Google Maps,
  Apple Maps, or other maps: their data is copyrighted, and OSM can't use it.
- **Go in pairs**, in daylight. Stay off roadways and out of buildings and areas that aren't open to you. If anyone
  asks, you're mapping walkways for Access BC, Boston College's accessibility map.
- **Bring** a phone with the camera and a notes app (or the printed checklist below). A GPS track is useful but
  optional (any free "GPX recorder" app).

## 1. Walk and note (about two hours)

Walk every walkway between buildings, and from the campus to the street sidewalks and bus stops. Take a photo at
anything below; photos make the drawing much easier.

| Note | Why it matters |
|---|---|
| **Steps**: where, how many, a handrail? Is there a ramp or level way round? | Wheelchair users can't use steps; people with canes need the count and handrails |
| **Ramps**: where, roughly how steep (gentle, moderate, steep), handrails? | Steep ramps are hard or unsafe to use |
| **Curbs** where a walkway meets a road or parking lot: lowered (a curb ramp), flush, or raised | A raised curb blocks a wheelchair |
| **Surface**: asphalt, concrete, brick or pavers, gravel, grass | Gravel, grass, and broken surfaces are hard going |
| **Narrow spots** under about 1 m (3 ft): bollards, gates, planters | Wheelchairs need about 1 m to pass |
| **Building entrances**: which doors are step-free; automatic door, push button, or neither; card access only? | Directions go to accessible entrances |
| **Crossings** of campus roads and drives: marked or not | Where it's safest to cross |
| **Lighting** at night, if you know | For routes after dark |

## 2. Draw it in OSM (about two hours)

1. Go to [openstreetmap.org](https://www.openstreetmap.org), zoom to the Brookline campus (off Heath Street, by the
   Reservoir), and choose **Edit**. The iD editor opens.
2. **Choose the aerial photos:** open **Background** (the stacked-squares button, or the `B` key) and pick a
   **MassGIS** layer if one is listed (Massachusetts' own photos, which are sharp here); otherwise Esri World Imagery
   or Bing. Photos can be a few metres off: line up a building outline with the photo, and use **Imagery Offset**
   in the Background panel if needed.
3. **Draw each walkway** with **Line**: click along its middle, and double-click to finish. Choose **Foot Path** as
   the type (`highway=footway`). Where it meets another walkway, a sidewalk, or a road, **click on that line** so the
   two connect: unconnected lines can't be routed along.
4. **Add the details** in the sidebar (the "Text view" button lets you type tags directly):

| What you saw | Tags |
|---|---|
| Surface | `surface=asphalt`, `concrete`, `paving_stones` (brick and pavers), `gravel`, `grass` |
| Width (metres) | `width=1.5` |
| A slope you noted, in the direction you drew the line | `incline=up` or `incline=down`; or a percentage, `incline=8%` |
| Smooth or rough | `smoothness=good`, `intermediate`, `bad` |
| Wheelchair use | `wheelchair=yes`, `limited` (possible with difficulty), or `no` |
| Lit at night | `lit=yes` |

5. **Steps:** draw them as their own short line, type **Steps** (`highway=steps`), with `step_count=4` and
   `handrail=yes` or `no`. Draw them from the bottom up, so `incline=up` is right.
6. **Ramps:** draw a ramp as a Foot Path with its `incline`, and `wheelchair=yes` if a wheelchair can use it.
7. **Crossings:** where a walkway crosses a campus road, draw the crossing as a Foot Path with `footway=crossing`
   and `crossing=marked` or `unmarked`. On the point where it meets each curb, add `kerb=lowered`, `flush`, or
   `raised`, and `tactile_paving=yes` or `no`.
8. **Entrances:** add a point on the building outline where the door is, with `entrance=main` (or `yes`), and
   `wheelchair=yes`, `limited`, or `no`, and `automatic_door=yes`, `button`, or `no`.
9. **Save** (top right). For the comment, write what you did, such as *"Walkways, steps, and curb ramps on the
   Boston College Brookline campus, from a survey on 2026-10-25 #AccessBC"*, and for the source, *survey; MassGIS
   imagery*. Your changes are live in a few minutes.

If you're unsure about something, leave it out, or add a note (`note=...`) saying what to check. Leaving something
unmapped is better than guessing: Access BC would route people along it.

## 3. Tell Access BC

Email the Access BC team (or use the feedback form) with the date you mapped and anything you couldn't map. Send the
photos of steps, ramps and entrances too: those details go into BC's own entrance data as well.

**For the Access BC maintainers**, to bring the new paths into the app:

```bash
node scripts/osm-sidewalks.mjs
node scripts/link-entrances.mjs
node scripts/make-data-collection-sheets.mjs
```

The first refreshes the OSM walkways (the Brookline campus is already inside the area it covers). The second links
the campus entrances to them. The third updates the lists of what's still missing. Then check a few routes to
Brookline buildings in the app before deploying. The walkways count as "not checked" in Access BC, like other OSM
data, until someone at BC confirms them.

## Printable checklist

| Where (building or landmark) | What (steps, ramp, curb, surface, narrow, door, crossing) | Details (count, handrail, lowered/raised, push button, …) | Photo # |
|---|---|---|---|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
