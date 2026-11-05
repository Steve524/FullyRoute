GENERATED FLOOR PLANS

20 synthetic demonstration plans: four floors (0, 1, 2, 3) for each building:
McCarthy Hall, Education Classroom, Engineering, Computer Science, Humanities.
Floor 0 is the ground floor. These floor counts and room numbers are invented.
They do not establish real campus rooms, uses, dimensions, or navigation routes.

START HERE
all_floor_plans.png is a contact sheet of all 20 plans with building/floor captions.
plans/<building_id>/floor_<number>.png contains the individual transparent image.
The adjacent SVG contains editable wall lines, door swings and text, plus raster
masks for the exact boundary and perimeter. PNGs retain the source aspect ratio.
The building and floor name are in the filenames, contact sheet, and CSV records;
only the reference-style room, corridor and core labels appear inside each plan.

DATA
buildings.csv: one row per building; name, source, mask and original canvas size.
floors.csv: one row per floor; building, floor name, PNG/SVG path and room count.
rooms.csv: one row per numbered space, including classrooms, offices, labs,
stairs, elevators, restrooms and support rooms. Each row names its building,
floor, visible room number, use, image, geometry, label anchor and doorway.
corridors.csv: the same space schema for circulation segments.

All files are UTF-8 with headers. Preserve room_number as TEXT, including leading
zeroes and suffixes. space_id is unique across buildings and floors. floor_id
joins rooms/corridors to floors; building_id joins all tables to buildings.
core_id identifies the same stair or elevator across the building's four floors.
Paths are relative to this folder. Existing database migrations are not changed;
these CSVs are a standalone dataset, not an import into an established room table.

COORDINATES AND BOUNDARIES
Coordinates use the FULL original source image, normalized to 0..1000 on each
axis: x increases right, y increases down. For a displayed PNG, pixel_x is
label_x * image_width_px / 1000, and pixel_y uses the corresponding height.
The axes have different physical scales; these are diagram coordinates, not
meters. polygon_json is a JSON list of [x,y] vertices, quoted inside the CSV.
Door sides N/S/E/W mean top/bottom/right/left room wall in the unrotated drawing.

Final room geometry is its polygon INTERSECTED WITH the building's mask. Some
perimeter bays deliberately extend beyond the footprint and are clipped. Use
the mask when displaying or processing geometry; raw polygon rectangles alone
do not describe the irregular building edge. Small residual edge strips are
unassigned background, not surveyed rooms or corridor/navigation data.

Every floor uses the SAME supplied outline for its building. The mask is
extracted at original image resolution from the largest connected navy region,
with enclosed lettering filled. All final PNG alpha pixels exactly equal the
nearest-neighbor enlargement of that mask. The source images have raster,
antialiased edges: exactness means this documented binary extraction, not an
unavailable architectural/vector survey. McCarthy's connected small bottom spur
is retained even though it may be an illustration artifact. See footprints.json.

STYLE AND FLOOR VARIATION
Clean navy fill, pale blue walls, white Arial bold room numbers, quarter-circle
door swings, cyan stair accents. Ground/first floors mix teaching rooms and
support spaces. Second floors use larger merged lab/teaching bays for a more open
composition. Third floors use finer office subdivisions. Cores remain fixed.
Floor 0 rooms use 1..99; upper floors use 1xx, 2xx and 3xx. Corridor identifiers
follow 000C1/100C1/200C1/300C1, with corresponding S and E core labels.
Room numbering may skip values after room merging; no duplicate labels occur.

SOURCE AND REPRODUCTION
references/ contains the five supplied building images and four layout guides.
masks/ contains the five original-size binary building outlines.
specs/*.json are the final authoritative layout records.
review/style_analysis.json records the reference styling decisions.
review/data_contract.json is the delegate's proposed schema, retained as design
notes; the ACTUAL exported columns and identifiers are documented above.

Python with Pillow and numpy is required to regenerate. From this folder:
  python render_plans.py
  python validate_specs.py
  python verify_exports.py

finalize_specs.py records the one-time second-floor adaptation and provenance;
it is idempotent. The earlier per-building helper scripts beside the JSON files
are delegate construction notes; do not run them to regenerate the final specs.
extract_footprints.py records the extraction and original attachment paths.
The copied references and saved masks make rendering independent of those paths.
No image-generation API or secret is required; these are deterministic diagrams.

VALIDATION
review/spec_validation.json checks numbering, geometry, corridor connectivity,
label/door anchors and stable cores. There are no errors; perimeter-clipping
warnings are expected because final geometry is intersected with the mask.
review/render_validation.json checks mask equality and actual rendered text
containment/collisions. review/export_validation.json verifies the SAVED PNGs,
SVG text, CSV keys, counts and relative image paths. Fonts are at least 17 px
in the delivered PNGs. There are no rendered label collisions.

WORK ALLOCATION
Eight GPT-6.1 Sol delegates, medium reasoning: two each on codex,
codex_personal2, codex_work1 and codex_work2. Five designed individual buildings;
three analyzed styling, extracted masks, and wrote the data contract/validator.
The parent assembled images/CSVs, adapted floor 2 and checked final exports.
