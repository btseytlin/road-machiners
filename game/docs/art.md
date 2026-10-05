# Art pipeline

Static props, obstacles, landmarks and truck parts are low-poly Blender models. Settlement houses, ruins, water and some hull sections are built from Three.js shapes in code. Models placed many times are drawn as instanced meshes, one per terrain chunk: rocks in `src/three/render/obstacles.ts`, and dead trees in `TreeInstances` in `src/three/render/trees.ts`, since a grove holds hundreds of trees. The ground is one painted canvas texture over the whole map, and a shader draws roads and pads on it. Open desert mixes toward the warm sand `PAL.desertSand` in slow, gentle patches, rust-brown roads fray into light rim sand with grey stones, and the ground shader tints each terrain triangle a little apart so flat ground reads as low-poly facets. Pebbles, scrub and cacti are instanced 3D models from `src/three/render/scatter.ts`, without collision. Open desert takes `desert_stones`, `desert_scrub` and `cactus`, and ground without a desert look keeps the small brown `pebbles` and dry `scrub`. Desert scrub is an upright clump of olive `PAL.brush` stems, and cacti stay under 1.3 m so driving through one never looks like a crash. Desert stone clusters mix a light warm grey `PAL.desertStone` stone, a cool grey `PAL.stoneGrey` one and a terracotta chip. Loose boulders and crags use the terracotta `PAL.stone`, and stone walls and other models keep the grey-brown `PAL.rock`.

Some models come from Blender scripts in `tools/blender/`. Blender is installed with `brew install --cask blender`. Each script writes a `.glb` into `public/models/`, and both are committed. Rebuild one with `blender --background --python tools/blender/<name>.py -- public/models/<name>.glb tmp/<name>.png`. The second path is an optional preview render from the game camera angle.

## Adding a model

1. Copy `tools/blender/wreck.py` as the template. It shows the script shape: a `COLORS` table, a `build(kit)` function and a `main()`.
2. Build from `Kit.box()` and `Kit.cylinder()` in `tools/blender/kit.py`. `tools/blender/shapes.py` adds struts, tapered cylinders, ladders and wall patches. Add shared helpers to those files and one-model helpers to the model's script.
3. Work in meters with Z up and the front facing +X. Keep the origin at the model's ground point.
4. Size the model to a reference radius or footprint from the sim, and state it in the docstring. The game scales it from there.
5. Take colors from `src/render/palette.ts` and name the palette key in a comment. Blender cannot read the palette, so keep both in sync.
6. Keep the low-poly style: few vertices per cylinder, flat shading, and small seeded `dent_by` values for worn metal.
7. Fix the seed, so a rebuild gives the same file.
8. Render the preview and look at it before wiring the model into the game.
9. Add the name to `NAMES` in `src/three/render/models.ts`. Use `model('<name>')` in a view, or `instancedModel()` for many copies. Boot fails if the file is missing.
10. Take an in-game screenshot with a Playwright script in `tmp/`, and run `npm run playtest`. The user confirms small visual details.

`models.ts` loads every model at boot. It swaps the glTF materials for flat Lambert, so models match the procedural meshes.

## Models from a concept image

When a place has a concept image, like Old Orchard's `docs/concepts/old-orchard-issue-111.jpg`, model each building it shows from a crop of the image with the `blender-image-to-3d` skill, then write the result as a Kit script by the steps above. Keep the briefs and review sheets in `tmp/models/<name>/`. The concept is a perspective painting, so take sizes from scale cues (a road about 10 m wide, a truck about 8 m long, a storey about 3.2 m) and judge the review sheets by eye.

Old Orchard's models were built this way: `farmhouse`, `barn`, `quonset`, `guard_post`, `army_truck`, `barrier`, `drums`, `woodpile`, the `bunker` blockhouse with its sandbag ring, and `dead_tree`. `LANDMARK_MODELS` in `src/sim/mapgen.ts` maps each prop look to its model, and `MODEL_RADIUS` holds the footprint radius from each script's docstring.

The `desert_scrub` and `cactus` scatter models were built the same way from `docs/concepts/wasteland-reference-issue-129.jpg`, sized against the 5.5 m van in it.

Size a building against the 8.1 m army truck, the one size cue a concept and the game share. The orchard's models are measured from the concept in army trucks and pinned by the size table in `src/data/prop-shapes.test.ts`:

- `quonset` 22 m long (2.7 trucks), 12 m wide, 6.5 m tall;
- `barn` 24 m long (3 trucks), 16 m wide, 10 m tall; its shed is the same model posed smaller;
- `farmhouse` 26 m with its wing, 14 m deep, 11 m tall;
- `bunker` blockhouse 14 m square and 5 m tall, 22 m with its sandbag ring;
- `dead_tree` crown 6.5 m across and 5.5 m tall;
- `drums` about 2.5 m across, `woodpile` about 4 m long.

A prop that trucks drive under keeps every box below `PHYSICS.truckClearance` (2.8 m) inside its trunk's footprint. Boxes whose bottom is at or above it block neither driving nor nav, but they still block sight. `scripts/prop-shapes.mjs` merges the dead tree's boxes below and above that height apart, so the crown never reaches down to the ground.

## Trucks

Each truck is one base model per chassis plus shared kit parts on its inventory grid. The grid is a logical layout for balance: slots, armor lanes and what shields what. It holds no meters, and the inventory draws it with square cells. The model owns everything physical: the collider, the wheel positions, the engine spot and the surfaces parts stand on. One projection in `src/sim/body.ts` links them, and nothing else converts between cells and meters.

- `cellCenter()` and `cellRect()` stretch the inner cells evenly over the model's footprint and put the armor ring cells on its outer faces, so a side plate is skin that adds no width.
- `restOn()` picks where a part rests: on the surface that keeps the most of its footprint, shrinking the drawn part away from anything taller, like a bed wall, so it cuts no more than 5 cm into the model and stands on at least half its footprint. A part on a clean slope, like a raked window or a sloped hood, tilts to lie on it. A good or loose part that fits nowhere would float, so it is not drawn. `restOn()` never throws: over air, like an armor row where the model is narrower than the grid, it returns a perched rest, and a test places every part shape on every cell, ring included. Guns stand on posts and always show. A test checks every chassis, cell and part size and reports how many perch.
- `engineAnchor()` is the model's hood hole, where a mounted engine is drawn wherever its `E` cells lie. Engines show in the hood hole on every chassis.
- A chassis's `showsCores` flag says whether the view draws its transmission and fuel tank. It is true for the junk-built trucks where parts stick out (scout, courier, wagon), and there the two parts must stand on a low surface, never a cab roof. It is false for the others, whose bodies cover the parts, so they count in the grid but are not drawn.
- A grid may have more rows or columns than its model, since the projection stretches it over the model, and every chassis but the scout keeps a free 2x2 block of deck cells. The cab, transmission and engine bay keep clear of the wheel columns, the transmission covers the middle column or columns, and a cab is a 1x2 open seat or a 3x2 closed cab, either way round. So a grid change for balance never changes the look or the driving.
- Loose tests in `src/sim/body.test.ts` keep the grid roughly true to the model: the `E` cells lie in the half of the truck with the hood hole, each wheel cell in its corner, and every inner cell over the model. Cells may be about half to a full-size cell.
- `npm run models:shapes` turns each `base_*` model into collision boxes and a top surface height map in `src/data/truck-shapes.json`, and a test fails when a shape is stale. `bodyOf()` returns those boxes, cut at the chassis bottom and at `PHYSICS.truckRoof`, and takes `half` from their bounds. Wheel positions and the engine anchor are per-model data in `PHYSICS.bodies`.
- The base, `tools/blender/base_<chassis>.py`, has its origin at the collider center, so the drawn truck hits where it is drawn. Each base copies a real vehicle in the stylized style of `base_scout.py`: big flat panels and few strong color blocks, readable at the default zoom. `tools/blender/parts_common_base.py` holds the shared style and checks. `src/render/partLooks.ts` maps each chassis to its base.
- A base with `arch_front`, `arch_rear` and `arch_front_top` sockets has its arches checked against `PHYSICS.bodies` by `src/three/render/wheelArches.test.ts`: the hub, the axle distance, the track and the crown. The Lincoln, Niva and Bukhanka (issue 149) are pinned to their reference photos by the proportion table in `src/data/truck-shapes.test.ts`, and `gunRisers.test.ts` requires that every gun spot on their deck cells rests on the model, except the `UNRESTABLE` spots: `restOn()` cannot rest a gun across a step, so a long spot that spans a hood-to-roof step perches. Keep steps off the middle of a spot where the grid allows.

## Part models

- Build a part for its rotation-0 footprint: w cells across in Blender Y and h cells along in Blender X, with the nose at +X. Truck right is Blender -Y. The origin is the footprint center on the deck top.
- The view turns a part for rotation 1 and stretches it to the turned footprint. So keep parts boxy.
- Build armor as a front-edge row with its outer face at +X. The view turns it to the side its cells lie on. A mounted side plate is drawn thin on the model's outer face, and rams replace the bumper.
- Items stand on their row surface. An engine on its mount cells shows through a cutout in the base. A weapon below the base's highest row surface stands on a riser post, so its turret clears the cab.
- A material named `paint` takes the faction color, and `trim` on a base takes the faction's second color. Other materials keep their colors.
- `src/render/partLooks.ts` maps each part and good id to its model. A part with no model stops the build.
- Weapons are assembled from a mount, a receiver, a barrel and an optional extra. They join at sockets made with `Kit.socket()`: `head` on mounts, and `muzzle` and `extra` on receivers. Each weapon def has a pool per slot in `WEAPON_POOLS`, and the part id picks from it. Boot fails when a pool model lacks a socket.

## Fortress kit

Each inhabited site is walled by fort pieces, one model per style and piece, named `fort_<style>_<piece>.glb`. A style is a material and a site's look, so the five sites remade from their concepts each have their own kit file, and work on one never touches another's.

- `tools/blender/fort_kit.py` builds the masonry and scrap styles in five pieces each: wall, tower, gate, bastion and inner gate. It also holds the geometry helpers the other kits import: `extrude`, `plate`, `frame`, `rect` and `SKIRT`. Its gatehouse stands out on the site circle, and a barbican joins it back to the curtain.
- `fort_patchwork_kit.py` (Bowl), `fort_compound_kit.py` (Dustwell), `fort_ring_kit.py` (Granary), `fort_yard_kit.py` (Salvage Yard) and `fort_ship_kit.py` (Nose) each build their style's wall, gate and, except for the towerless ring, tower. Each `fort_<style>_<piece>.py` script calls its kit's `run(piece)`.
- These five styles have flush gates: the gatehouse stands in the curtain with its outer face on the curtain line, and nothing reaches past that face. Each style's gate size lives in `FORTRESS_STYLES` in `src/data/fortress.ts`, and a test checks it against the gate model's height.
- Every wall is 8 m long and under 3 m deep, at least 12 m tall and over 3x the tallest truck. Nose's ship-metal wall is 16 m, its towers 22 m and its gate catwalk 18 m, so its ring reads as a band at the zoom that fits it. The game stretches it along its length only, so keep its detail repeatable along that axis. Towers keep a 6 m footprint. Each kit's docstring states each piece's size and origin.
- Gate lamps, guns and banners are not part of any gate model. The gate furniture in `src/three/render/sites.ts` owns them.

Nose's colony-ship wreck is four sections, `ship_nose`, `ship_hull_ring`, `ship_hull_ribs` and `ship_hull_stern`, about 180 m long and 36 m across. They share a 12-sided profile, large rust-edged plates and ring frames from `tools/blender/ship_hull_kit.py`, so their joints meet. The origin of each is the hull axis at a joint. The nose is plated, with a cockpit band, a side window row and the radar pedestal. The ring is plated, the ribs show a lattice of ribs and X-braces with a few plates left, and the stern is torn open.

The ship rests on `nose_rise` and runs into `nose_crag`, two render-only rock masses from `tools/blender/nose_rise.py` and `nose_crag.py`, built by `nose_rock_kit.py` as faceted heightfields. They share the site frame of Nose's interior: the origin is the site center, +x runs along the ship toward its nose and +y toward the south gate. `nose_rise` carries the ship's pose in two sockets, `socket_ship_front` and `socket_ship_rear`, on the hull axis, and its front edge is a timber-and-scrap retaining terrace 6 m high. The footprints, the hole it leaves at the WNW gate and the rule that nothing reaches past 120 m of the center are constants in `nose_rock_kit.py`. `RISE` in `interiors/nose.ts` mirrors them, and the interior throws when the gate is not at the hole.

Two material rules serve the site interiors:

- A material named `glow` keeps its color as emissive, so lit windows and lamps show at night with no point lights. `toLambert()` in `src/three/render/models.ts` applies it.
- A moving part, such as a windmill rotor, pumpjack beam, crane upper, crane grab or radar dish, is its own model with its origin at its pivot. It attaches at a `socket_<part>` on its base model (`Kit.socket()`), and `SiteMotion` moves it.

Run `npm run models:shapes` after a change, as for any prop.
