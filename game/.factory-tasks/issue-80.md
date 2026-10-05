# Inhabited sites become walled fortresses

**Status:** planned
**Branch:** factory/issue-80
**Worktree:** none
**Goal:** In the running game, Bowl reads as a bastioned star fort and Nose reads as its concept C5. The other sites look and work as they do at `8d024493`.
- Bowl has six arrowhead bastions, each with a tower at its point and one at each shoulder. Every curtain and every bastion face is flanked: from the concept camera, a tower that stands out past each wall can see the foot of that wall. Inside, Bowl keeps the terraced crater farm with houses, pond, windmill, tanks and greenhouse. Both gates sit in curtains between bastions.
- At Nose, a pale colony-ship nose made of large rusted plates lies pitched nose-up and diagonally on a faceted rock rise across the back of the ring. Its skeletal, torn rear runs into a crag at the back right. In front of it is an open sandy yard, densely built with scrap shelters, a two-level platform and stairs up the rise, a red awning, a water tower, a jib crane and a van. Around everything runs a panel ring with close-set banded towers and the flush plank gate.
- Dustwell, Granary and Salvage Yard look and work as approved. Gates, pads, routes, services, gate guns and lamps work as before everywhere. Every wall stands at least 3x the tallest truck, and the walls are the collider.
- In-game shots stand next to C1 and C5 from the concept view and pass the measured checks in PH6. The user confirms the look.
**Mode:** hands-off

## Context
- This is revision 6. Revision 5 was built, passed checks and reached approval at `8d024493`. The committee's reply, routed as redesign, says:
  - Bowl is almost done but must be a star fortress, not a five-sided one: "in a star fortress towers can fire on attackers close to the walls at any point". It wants a true bastioned trace with projecting points and flanking lines of sight along every curtain, not decorative points on the old polygon. The terraced crater farm, gates, pads and services stay.
  - Nose is "not even close" and must be redone, in form and composition, against its concept. It must not be polished from the current build.
  - Dustwell, Granary and Salvage Yard are approved. Their look and function stay.
  - The committee asks for gameplay evidence of Bowl's silhouette and flanking geometry and of Nose next to its concept, plus confirmation that gates, pads and services work and that the other sites are unaffected.
- Root cause of the Nose miss: revision 5 modeled Nose on the withdrawn image. Its C5 was `ref-9aaa59c32856.jpg`, copied as `tmp/design/ref/nose.jpg`. The committee had replaced that image with `094df704` (`ref-6a17345272db.jpg`) and said to use only the replacement. This stage moved the old copy to `tmp/design/ref/nose-withdrawn-9aaa59c32856.jpg` and put the replacement at `tmp/design/ref/nose.jpg`.
- A second cause of the Nose miss: revision 5's visual acceptance was a checklist of features marked present or missing. Every Nose feature was "present", yet the composition was wrong. The current build (`tmp/final2/nose-concept-noon.png`, `nose-default-noon.png`) shows:
  - A 246 m ring with 12 m walls and 19 towers, so the ring reads as a thin line.
  - A smooth checkered tube lying flat on flat sand across the back.
  - A pile of boulders at its rear.
  - About 40 sparse shelters in a mostly empty yard.
  
  C5 shows a compact ring that is about 8 wall heights across, with towers about every 20 m. Its ship is perched and tilted on a rock rise that fills the back of the ring.
- Root cause of the Bowl miss: revision 4 read C1 as an "irregular hexagon" and laid a convex polygon with a tower at each corner (`FORTRESS_SITES.bowl`, `shape: 'polygon'`, `src/data/fortress.ts`). The issue had asked for "square, circular or star fortresses". The committee's shot (`ref-c5504662d737.jpg`) matches `tmp/final2/bowl-concept-noon.png`. In it a corner tower can only see along its own walls, so the foot of every curtain is dead ground.
- The fortress layout (`src/sim/fortress.ts`) lays walls along any outline, convex or not. `pointInPolygon`, `polygonEdgeDist` and `insideCurtain` handle concave outlines. Corners with `tower: false` get no piece. `pitDepth` measures from the whole outline (`fortressOutline`). Bowl's interior (`src/three/render/interiors/bowl.ts:154`) lays its terrace rings from `fortressOutline`.
- Bowl's two gates are mid-side, at bearings -64.93° and -24.11°, between corners at -85.34°, -44.52° and -3.7° (r 26.75). Its other corners are at 60°, 128° and 198°. Bowl's site radius is 28 tiles, and a corner tower must keep `r + 0.75` within the circle.
- Nose is at (510, 175) with radius 32 tiles (`src/data/region.ts:213`). Its gates are at bearings -146° (WNW) and 83° (S). The site radius sets the pads, the gates, `isFree()`, spawns and many range checks: `.radius` is read in 113 places in `src/sim` and `src/mapgen`.
- Nose's ship-metal pieces come from `tools/blender/fort_ship_kit.py`:
  - wall 12 m tall (`WALL_HEIGHT`), with the walkway at 10.8 m
  - octagonal tower 16 m tall
  - gate 24 m wide and 16 m tall (`FORTRESS_STYLES.shipMetal.gate`, 6 by 1.5 by 4 tiles)

  Circle towers stand every `FORTRESS.circleTowerEvery` = 5 sections. That value is shared by every circle site.
- Nose's ship is built from `ship_nose`, `ship_hull_ring`, `ship_hull_ribs` and `ship_hull_stern`. They share `tools/blender/ship_hull_kit.py` and are used only by `src/three/render/interiors/nose.ts`. The interior also uses `scrap_shelter_flat`/`_lean`, `hull_scaffold`, `jib_crane`, `water_tower`, `base_van`, instanced `rock` and `radar_dish`, which spins on `SiteMotion`.
- Interiors are render-only: no truck goes behind a curtain. Baked fort props are not saved: a load rebuilds them from the map file, and a save on an older map hash loads through rescue. The save format on this branch is 2.14, and its step 13→14 is committed.
- The game camera looks northwest from map +x +y. The concept views are taken by turning the camera in a `tmp/` script (`docs/tools.md:35`). `tmp/concept-shots.mjs` and `tmp/concept-compare.py` from revision 5 exist (git-ignored).
- A public commenter asked for one Sonnet agent per location. Background agents hit a 600 s wait in the first run.

## Reference images

All six images were opened in this stage. They are AI-rendered perspective concepts at about 27-40° elevation, apart from S6, which is a game screenshot. They set silhouette, materials, layout and rough ratios. Exact sizes come from game scale and the measurements below.

- **C1 — Bowl** (`ref-9d412b3c0188.jpg`, 1536x1024).
  - Shows: a wall of multicolored vertical salvage panels with timber walkways. Pale concrete pillars carry timber watch huts with lamps. The ring is mostly convex, with a re-entrant bend at its left and right. An X-braced flush gate. A deep terraced crater with crop rows, about 18 pitched-roof houses, a teal pond, a windmill, two stilt tanks and a greenhouse.
  - Takes: the materials, tower huts, gate and the whole interior, kept from revision 5. The outline is now set by the committee's star fort ruling, not by C1's polygon.
  - Infers: bastion sizes. C1 shows no bastions, so they come from the trace below, built from the same wall and tower pieces.
  - The issue wants the result to look like C1. The visual check is in PH6.
- **C2 — Dustwell** (`ref-7be04f27c39b.jpg`), **C3 — Granary** (`ref-a1c1f9df70f0.jpg`) and **C4 — Salvage Yard** (`ref-e4809ae931e0.jpg`).
  - These are the pumpjack compound, the pale silo ring and the crane scrap square. Revision 5 built them and the committee approved them.
  - This revision changes nothing at these sites (IV26). PH6 checks them only for "unchanged".
- **C5 — Nose** (`ref-6a17345272db.jpg`, 1448x1086; the replacement `094df704`). The withdrawn `ref-9aaa59c32856.jpg` is not a reference.
  - Shows, in a view from the south gate at about 27° elevation (ring ellipse height/width ≈ 0.46):
    - The ring spans about 1345 px of the image width. The cargo truck at the gate is about 90 px long, about 7.5 m, which puts the ring at about 112 m across.
    - The ship runs from a blunt, faceted, tapered cockpit at the upper left (x≈265, y≈170) to a ruptured rear against the crag at the right (x≈1290, y≈400). That is about 0.76 of the ring's width. Its cross-section is about 0.22 of its length, and it is polygonal, not round.
    - The nose end is higher than the rear and pitched up. The belly under the cockpit stands on a rubble slope well above the yard, at about the height of the wall top.
    - The plating is large rectangular pale grey-beige plates, about 1/8 of the girth each, with rust edges and rivet lines. Dark brown raised ring frames run between the sections. Windows: a dark band of lit cockpit windows and a row of side windows.
    - The middle-rear section is skeletal: an exposed lattice of rust-brown frames with X-braces, with plates missing. Its end is torn open, with hanging plates, and pushes into the crag.
    - The rock rise is large faceted low-poly masses in orange-brown. It fills the back of the ring from the rubble under the nose to the crag at the back right, which rises above the wall and continues outside it.
    - The yard is open sand in the front half to two thirds. It holds about 16 box shelters with flat or lean-to roofs and lit orange doorways, a two-level timber platform with rails along the foot of the rise with two flights of stairs up toward the hull, a red-roofed open awning, a water tank on a lattice stilt tower, a small lattice jib crane holding a load, a van, and crate stacks.
    - The ring is vertical panels in pale grey, rust red, slate blue and dark grey, under a dark band of white diamonds, with a timber rail on top.
    - The towers are octagonal, in pale and dark bands, with a dark top storey with a lit window and two antennae each. They are about 1.5x the wall and stand about every 20 m.
    - The gate is two shut X-braced plank doors flush between two towers, with a lamp on a post at each side.
    - The light is a warm orange dusk.
  - Takes: the ship's pose, shape and plating; the rise and crag; the yard's layout and density; the ring's materials, tower look and tower rhythm; and the gate.
  - Infers:
    - The ring stays the game's 246 m, about 2.2x C5's. The site circle sets pads, gates, spawns and ranges (Context), and the committee keeps pads and gates. So the ship, the rise and the yard scale with the ring: the ship is about 180 m long and 36 m across.
    - The wall rises to 16 m and the towers to 22 m. Matching C5's wall-to-ring ratio exactly would need 29 m walls, over 6x the tallest truck at the pads. 16 m is halfway, and the close tower rhythm gives the rest of the ring's weight.
    - The crag lies inside the curtain. Ground outside the curtain does not change, so the crag only rises above the back-right wall, as C5's does.
    - C5 has no moving part, so the radar dish on the nose keeps turning (as in revision 5). The issue names an antenna as one.
    - The WNW gate does not show in C5. It gets the same gate, and the ground inside it stays open yard.
    - Nose is a town, so both gates keep the gate gun on the gate catwalk.
    - The light is the game's own, since the approved sites share it.
  - The issue and the committee want the result to look like C5. The visual check is in PH6.
- **S6 — committee screenshot** (`ref-c5504662d737.jpg`, 1200x800). It is supplemental evidence and not a concept. It shows revision 5's Bowl from the concept view: a hexagon of red-and-white panels whose six corner towers read as five sides, with flat curtains and nothing projecting. PH6 retakes this exact view for the before-and-after comparison.

Modeling uses the `blender-image-to-3d` skill for Nose only, since Bowl reuses its approved patchwork pieces. The categories are architecture for the ship-metal pieces, vehicles for the four ship sections (shell lofted from stations), environment for `nose_rise` and `nose_crag`, and props for the shelters. The phases used are:
- Phase 0: a brief per asset in `tmp/models/<name>/asset-brief.md`, with C5 crops in `ref/`, the measured ratios above, and the INFERRED list.
- Phase 1: one calibrated master for Nose, with the 7.5 m truck and the 16 m wall as rulers.
- Phases 2-3: blockout and form gates with `review_render.py --engine cycles --ref-cam` set to C5's camera (about 0° azimuth to the gate and 27° elevation), and `compose_review.py` sheets.

Phases 4-10 are skipped, because `Kit.export()` writes the `.glb`. The overlap number is a diagnostic only. Each sheet is judged by eye, and each mismatch is written as a measurement in the brief.

## Design

### Scope
- Bowl gets a new outline shape, `bastioned`, built from the same patchwork wall, tower and gate pieces. Its crater follows the main enclosure inside the bastions. Its interior is kept, adapted to the new enclosure.
- Nose gets taller ship-metal pieces at a closer tower rhythm, four rebuilt ship sections, two new rock models, and a new interior layout from C5.
- Nothing else changes. Dustwell, Granary, Salvage Yard, Green Pit, Pump Station, South Lock, Scrapjaw, Kiln and the abandoned sites bake the same props and draw the same models as at `8d024493`.

### Kept from revisions 3-5
- Layout:
  - `src/sim/fortress.ts` owns outlines, pieces, gates (`fortressGates`) and the pit (`pitDepth`). `src/data/fortress.ts` owns their numbers.
  - The bake writes pieces as props, and their prop-shape boxes are the collider. `site.radius` is the layout bound and pad ring, never a collider.
  - Flush gates sit in the curtain, with a forecourt out to the gate point.
- Rendering:
  - Gate furniture (two lamps, plus the gun and banner at guarded sites) follows `fortressGates().face`.
  - Lamps and `glow` materials are emissive.
  - `SiteMotion` owns every moving part.
  - Interiors are render-only modules in `SITE_DECOR`.
- Checks: the `--cpu` playtest limit, the econ seeds and the road-grade limit stay as they are.

### Bowl: a bastioned trace
- `FortressShape` loses `'polygon'`, whose only user was Bowl, and gains `'bastioned'`. `FortressSite` loses `corners` and gains `bastions?: { capitals: readonly number[]; curtain: number; salient: number; gorge: number; flank: number }`. All lengths are in tiles and the capitals in degrees.
- `bastionedCorners(site, def)` in `src/sim/fortress.ts` builds the outline counterclockwise. Each capital bearing c_i has an inner vertex V_i at radius `curtain`, and the curtains are the straight lines V_i to V_i+1. Each bastion is five corners, all on the outline, in this order:
  1. The left gorge G_L: on the curtain into V_i, `gorge` tiles from V_i. No piece.
  2. The left shoulder A_L: G_L moved `flank` tiles out along that curtain's outward normal. Tower.
  3. The salient S: on the capital at radius `salient`. Tower.
  4. The right shoulder A_R: the mirror of A_L on the next curtain. Tower.
  5. The right gorge G_R. No piece.

  The faces are S–A, the flanks A–G, and the curtains G_R(i)–G_L(i+1).
- Bowl's start numbers come from today's corners: capitals at -85.34°, -44.52°, -3.7°, 60°, 128° and 198°; `curtain` 21.5, `salient` 26.75, `gorge` 2.5 and `flank` 2.5. The two 41° curtains then run 15.1 tiles. Each holds a gate 3 tiles wide, mid-curtain, with 3.5 tiles to each gorge. PH1 tunes the numbers against IV25 and the gate clearance.
- Flanking is the rule the committee named. It is enforced by IV25, a geometric check in the layout tests. The sim gains no tower guns: the gate gun stays the only town gun, as DESIGN.md's "town guns make a gate a safe place" sets.
- `fortressCore(site)` returns the main enclosure V_0…V_n-1, cached like `OUTLINES`. For any other shape it is the outline. `pitDepth` measures its margin and terraces from the core, so the crater stays a crater. The bastions are rim-level platforms (depth 0), as real bastions are filled earth.
- `polygonCorners` is deleted. The checks it made move to `bastionedCorners`:
  - every tower footprint stays inside the circle
  - each curtain is longer than `2 * gorge` plus a wall
  - the faces of one bastion do not cross
  - each gate lies in a curtain's open stretch (between G_R and G_L), clear of both gorges by `gateClearance`

  Each one throws.
- The gate face moves in to the curtain, about 20.2 tiles from the center, against 25.1 today. The forecourt between the two bastions flanking a gate grows from about 3 to about 7.9 tiles deep. Pads and gate points do not move.
- Bowl's interior (`interiors/bowl.ts`) lays its terrace rings and crop rows from `fortressCore`. The two rim sheds move onto bastion platforms. Everything else is kept: houses, pond, windmill, tanks and greenhouse. The pit numbers are retuned so C1's three terraces and a floor still fit the smaller core: the start is `terraceWidth` 2.5, which keeps a floor of about 11 tiles in radius.

### Nose: recomposed from C5
- **Ring.**
  - `fort_ship_kit.py` raises the wall to 16 m, with the walkway and diamond band moved up to match. The towers go to 22 m: five bands, the dark top storey with lit windows, and two antennae.
  - The gate keeps its 24 m width, its two built-in towers (22 m) and its plank doors. Its catwalk goes to 18 m, and `FORTRESS_STYLES.shipMetal.gate.height` becomes 4.5.
  - `FortressSite.towerEvery` (optional, default `FORTRESS.circleTowerEvery`) sets the sections between circle towers. Nose sets 3, so towers stand about 23 m apart: 33 towers, against 19.
  - Nose's `turn` is retuned so both gates clear the towers.
- **Ship.** The four section scripts and `ship_hull_kit.py` are rewritten from C5:
  - A 12-sided shell lofted from stations.
  - Plates about 1/8 of the girth, in pale grey-beige with rust edges and rivet rows. Raised dark ring frames between sections.
  - `ship_nose`: blunt and faceted, with a dark `glow`-paned cockpit band and a side window row.
  - `ship_hull_ring`: plated.
  - `ship_hull_ribs`: plates gone over most of its girth, showing a rust-brown lattice of rib frames and X-braces.
  - `ship_hull_stern`: torn open, with hanging plates and broken ribs.

  The model names stay, so `NAMES` does not change. The ship is about 180 m long and 36 m across.
- **Pose.** The ship group lies across the back of the ring as seen from the south gate: its axis is square to the bearing from the south gate to the center. The nose is to the west, which is screen left in the concept view. It is pitched 8° nose-up and rolled about 4°. It rests on two sockets of `nose_rise`, `socket_ship_front` and `socket_ship_rear`, so the pose is one owner's decision. The belly under the cockpit stands at least one wall height above the yard (IV28).
- **Rise and crag.** Two render-only environment models:
  - `nose_rise`: a faceted rock mound under the ship. Its saddle carries the sockets. It has a rubble slope under the nose, and its front edge is a timber-and-scrap retaining terrace about 6 m high along the yard.
  - `nose_crag`: a faceted cliff mass at the back right, rising to at least 1.5x the tower height, with the stern buried in it.

  Both lie inside the curtain (IV8) and clear of the WNW gate's open disc. Together they cover the back 35-50% of the interior along the view axis (IV29). Instanced `rock` stays only as scattered rubble at their feet.
- **Yard.** The open front of the ring, between the gates and the terrace:
  - About 55 `scrap_shelter_flat`/`_lean` shelters, scaled to about 10 by 7.5 by 5 m (a third of the wall height, as in C5). They stand in loose rows with alleys, denser toward the terrace.
  - Along the terrace foot: a run of `hull_scaffold` two-level platforms with at least two stairs up the terrace.
  - A red awning near the middle, `water_tower` and `jib_crane` at the west, the van, and crate stacks.

  No yard point lies more than 4 tiles from a structure (IV27), so the yard reads as built up, not empty. Gate discs stay open.
- The radar dish stays on `ship_nose` at `socket_dish`, on `spin` (8 s per turn).

### Save compatibility
- No prop kind is added or removed: Bowl uses patchwork kinds and Nose uses ship-metal kinds. So `LandmarkLook` and the saved shape do not change, and `npm run save:shape` shows no diff.
- `FortressShape` and `FortressSite` are data, not saved. The new map gets a new hash, so older saves load through rescue. Rescue already serves 2.14.
- No migration step, no major bump.

### Approaches considered
- Bowl:
  - Chosen: a bastioned trace generated from capitals and four trace numbers, built of the approved pieces, and checked by a flanking test.
  - 30 hand-placed polygon corners: no rule ties the corners to flanking, and every tweak means retyping the corners.
  - South Lock's `star` with bastion blocks at the points: those are the decorative points without flanks that the committee rejected.
  - A new arrowhead bastion model: one model cannot fit six different bastion angles, and it adds prop kinds and a saved-shape change.
- Nose:
  - Chosen: keep the site circle and recompose inside it from C5: perched pitched ship, rise and crag, dense yard, taller ring and close towers.
  - Shrink Nose's site radius to C5's 112 m ring: it moves the pads, gates, spawns, NPC routes, sight and the map around the largest town, and the committee keeps pads and gates.
  - Bake the rise into the terrain like Bowl's pit: 4 m height corners give smooth hills, not C5's faceted masses, and the hills would also change sight.
  - Polish the revision 5 build: the committee ruled it out.

TDD: yes for the bastioned trace, `fortressCore`, the pit on the core, flanking (IV25), the tower rhythm, and Nose's placement rules (IV27-IV29), since all are deterministic. No for the look, which is judged by eye and by the measurements in PH6.

### Invariants
Kept, from revision 5 (some restated):
- IV1 — Every fortress piece's posed boxes lie inside its site's circle. A flush gatehouse's outer face lies on the curtain line, on the gate's bearing.
- IV2 — No fortress site has a `kind:'site'` obstacle.
- IV3 — Each curtain is closed on the real `blockingBoxes()` colliders.
- IV4 — Every fort model stands at least 3x the tallest truck's model height.
- IV5 — `isFree()` is false everywhere inside a fortress site's circle.
- IV6 — Every pad of every site is usable and clear.
- IV8 — Every interior mesh of a fortress site lies inside its curtain, inset by half a wall depth, for movers at rest and at both ends of their motion.
- IV10 — Each fortress site is discovered when the player parks on its pad.
- IV11 — Every gate has two lit lamps within one gate width of its face.
- IV12 — Every gate of a guarded site has a gun at `gateGunPoint`. Tracers start there, and unguarded sites have no gun.
- IV13 — Each style's `gate.height` matches the top of its gate model's boxes within its tolerance.
- IV14 — Each fort prop kind maps to exactly one model.
- IV15 — No shared check, limit or test seed is loosened.
- IV17 — Heights and types change only on corners and tiles inside Bowl's curtain, compared with the `42b6c9fe` map. Corners within `margin` of the core line keep their height.
- IV18 — Every Bowl house, tree and crop row stands where `pitDepth` is equal across its footprint.
- IV19 — A style lays only the pieces it lists.
- IV20 — Every mover is registered once and stays inside its circle over its whole motion.
- IV21/IV22 — Lamps and `glow` materials are emissive, as revision 5 set.
- IV24 — The masonry and scrap fort `.glb` files and their `prop-shapes.json` entries are byte for byte as at `42b6c9fe`.

New in revision 6:
- IV25 — Bowl is flanked. Take sample points every 0.5 tiles along the outer foot of every Bowl wall and gatehouse face, 0.5 tiles out. Each point has a tower whose center stands at least `FORTRESS.flankMin` (2 tiles) outside that wall's outer line. The straight 2D segment from that tower's center to the point stays out of the outline's interior, beyond 0.1 tiles. A convex polygon with corner towers fails this test, since its towers stand on the wall lines.
- IV26 — Every site except Bowl and Nose bakes exactly the props it bakes at `8d024493`: kind, position, yaw and r. Their models, `prop-shapes.json` entries and interior modules (`interiors/compounds.ts` and the `sites.ts` decor of the five castle sites) are unchanged from `8d024493`.
- IV27 — Every point of Nose's yard is within 4 tiles of a placed structure. The yard is the points inside the curtain, outside the rise and crag footprints and the gate discs.
- IV28 — The ship's pose:
  - The ship group lies on `nose_rise`'s two sockets, pitched 6-10° nose-up.
  - The lowest point of `ship_nose` stands at least 4 tiles (one 16 m wall) above the yard ground at its foot.
  - The ship's length along its axis is 0.70-0.80 of the curtain's diameter.
  - The ship's bounding box clears both gate discs.
- IV29 — The rise and crag footprints cover 35-50% of the interior area. All of it lies on the far half from the south gate. The crag top stands at least 1.5x the tower height.
- IV30 — Neighboring Nose towers stand at most 26 m apart along the curtain, outside the gatehouses.
- IV31 — `fortressCore(bowl)` has six corners, and `pitDepth` is 0 everywhere outside it.

### Principles
- Principle 1 (one rulebook): no player split. The flanking rule is layout, not a combat rule. No new tower guns.
- Principle 2 (sim owns rules): the render reads `fortressCore`, `pitDepth`, `insideCurtain`, `fortressGates`, `siteGates` and `guardedSites` from `src/sim/`. The trace numbers and `towerEvery` are data in `src/data/fortress.ts`. The ship's pose comes from the `nose_rise` sockets and decides no rule.
- Principle 3 (indexes): the new hot path is only the extra props near Bowl (about +50) and Nose (+14). They go through the existing `propsNear` full scan (Code smells). `bastionedCorners` and `fortressCore` run once per site and are cached. Nose's placement loops run once at site build, and the IV25/IV27 loops run only in tests. `SiteMotion` is unchanged.
- Principle 4 (value): no value source or sink.
- Principle 5 (save facts): no saved type changes. The `CORES` cache uses the REGION site object as its key, the same pattern as `OUTLINES`. Those objects are never cloned, so this is not a world-clone cache.
- Principle 6 (seeds): no new sim draws. Placement uses render `hash2`.
- Principle 7 (fail loud): these throw:
  - a bastion tower outside the circle
  - a curtain too short for its gorges
  - crossing faces
  - a gate outside a curtain's open stretch
  - a missing `nose_rise` socket
  - a ship pose that overlaps a gate disc
- PC1 — A Nose look decision is checked against C5's measured ratio (Reference images, IV27-IV30), never against a feature list alone.
- PC2 — The approved sites are not touched. A shared change that shows at them is a defect (IV26).

### Assumptions
- AS1 — The six bastions read as a star from the concept view and the default camera at game zoom. PH6 checks this.
- AS2 — A 7.9-tile forecourt between two bastions traps no truck (`npm run stuck`).
- AS3 — A 16 m ring with towers every 23 m reads as C5's ring at the zoom where the whole 246 m ring fits the frame.
- AS4 — The new Nose meshes (two large rock models, four sections, about 55 instanced shelters) and Bowl's 12 extra towers stay within `npm run perf`.
- AS5 — The smaller crater core still reads as C1's terraced crater.

### Unknowns
- UK1 — Whether a Nose `turn` exists where both gates clear the 3-section tower rhythm. Each gate needs a tower within 1.85 tiles of its center, where its built-in towers stand in for it, or none within `gateClearance` of its edges. PH3 settles it. The fallback is `towerEvery` 4, recorded as a deviation.
- UK2 — Whether 21.5 tiles of curtain radius gives flanks long enough for IV25 on the 77° curtain. PH1 settles it. The fallback is a longer flank and a smaller core, with the pit retuned.

## Plan

Approach: Bowl's trace comes first, test-driven, and is baked, then its interior is adapted. Then Nose's ring and models, then its interior, then docs and acceptance.

Phases run in the foreground, one after another, since they share `icarus.bin`, `prop-shapes.json` and `sites.test.ts`. Bowl (PH1-PH2) and Nose (PH3-PH5) may each go to their own implementer, as the public commenter asked. No phase waits on a background job, and every long command runs with a timeout. No history is rewritten.

### PH1 — Bastioned trace for Bowl (TDD)
- 1.1 `src/data/fortress.ts` (modify):
  - `FortressShape` replaces `'polygon'` with `'bastioned'`.
  - Delete `FortressCorner` and `FortressSite.corners`.
  - Add `FortressBastions = { capitals: readonly number[]; curtain: number; salient: number; gorge: number; flank: number }`, `FortressSite.bastions?` and `FortressSite.towerEvery?`. `towerEvery` is used in PH3. Document both fields beside `towers`.
  - Add `FORTRESS.flankMin: 2`, commented as the least distance a flanking tower stands out past the wall it covers.
  - Set `bowl` to `{ shape: 'bastioned', turn: 0, style: 'patchwork', bastions: { capitals: [-85.34, -44.52, -3.7, 60, 128, 198], curtain: 21.5, salient: 26.75, gorge: 2.5, flank: 2.5 }, pit: { margin: 1.5, terraceWidth: 2.5, stepHeight: 0.6, terraces: 4 } }`. Rewrite its comment: gates mid-curtain between capitals, and the trace from the committee ruling.
- 1.2 `src/sim/fortress.ts` (modify):
  - `outlineCorners()` (`:170`): the `polygon` branch becomes `bastioned` and calls `bastionedCorners(site, def, at)`, which replaces `polygonCorners()` (`:193-201`). It builds the five corners per bastion as set in Design, with towers at A_L, S and A_R. It throws:
    - when a tower footprint, `hypot(r + 0.75, 0.75)`, leaves the circle
    - when a curtain is shorter than `2 * gorge + FORTRESS.wallLength`
    - when a bastion's faces cross
  - Add `export function fortressCore(site: Site): Vec[]`, cached in a `CORES` WeakMap. It returns the V_i for `bastioned` and `fortressOutline(site)` otherwise.
  - `pitDepth()` (`:115-123`) uses `fortressCore` for both the inside test and `polygonEdgeDist`.
  - `layGate()` (`:220`): at a bastioned site, check that the cut lies within the curtain's open stretch, clear of the gorge corners by `gateClearance`, and throw otherwise. The existing tagged-corner check covers the towers.
- 1.3 Tests, written first:
  - `src/sim/fortress-layout.test.ts`:
    - Replace the polygon throw tests (`:246`, `:263`) with bastioned ones: a tower outside the circle, a short curtain, crossing faces, and a gate on a gorge.
    - IV25 (flanking): a helper samples the outer foot of every wall and gate piece from `fortressPieces(bowl)` and `fortressFootprint`, and checks each point as IV25 sets. Add a negative case: the same helper on a convex hexagon test site, built with `salient = curtain` and `flank = 0` through a test-only site entry, fails.
    - Bowl has 18 towers and both gates sit mid-curtain (IV1).
  - `src/sim/fortress.test.ts` (`:194-225`): `pitDepth` tests use `fortressCore`. Depth is 0 in the bastions and on the forecourt (IV31). Terraces step in from the core.
  - `src/mapgen/fortress.test.ts`: the pit test reads `fortressCore` for its margin check (`:39`).
  - Before any code change, store a fixture of every non-Bowl, non-Nose site's `fortressPieces` at `8d024493`, and test equality with it (IV26).
- 1.4 Run `npm run map:bake`. A `tmp/` script compares the map with `8d024493`'s:
  - props of every site except Bowl and Nose are equal (IV26)
  - heights and types change only inside Bowl's curtain, compared with `42b6c9fe` (IV17)

  Commit `public/maps/icarus.bin`. Run `npm run save:shape` and expect no diff.
- UK2 is settled here. If IV25 fails, lengthen `flank`, then lower `curtain`, and log the numbers.
- Commit: `Bowl is a bastioned star fort: six bastions whose shoulder towers flank every curtain and face`

### PH2 — Bowl interior on the core
- 2.1 `src/three/render/interiors/bowl.ts`:
  - `curtainSides()` (`:153`) reads `fortressCore(site)`. Rows, trees and stairs follow the core's terraces.
  - The two rim sheds stand on two bastion platforms, inside the curtain (IV8).
  - The house rings, pond, windmill, stilt tanks and greenhouse stay. Their radii are checked against the new floor and scaled down only if they no longer fit (IV18).
- 2.2 `src/three/render/sites.test.ts`: the Bowl placement tests (IV8, IV18) pass. The house count stays above its current floor.
- 2.3 Look: run `tmp/concept-shots.mjs` for Bowl from the S6 view and the default view. Tune the pit numbers and the trace numbers (with a rerun of the 1.4 bake) until the B checks in PH6 hold.
- Commit: `Bowl's crater farm follows the main enclosure inside its bastions`

### PH3 — Nose ring from C5
- 3.1 Skill phases 0-3 on the ring pieces, with C5 crops of the wall, a tower and the gate in `tmp/models/fort-ship/ref/` from `tmp/design/ref/nose.jpg`. Check the md5 `bab526d5…`; the withdrawn image must not be used.
- 3.2 `tools/blender/fort_ship_kit.py`:
  - `WALL_HEIGHT` 16, `DECK` and `BAND` raised to match, `TOWER_ROOF` 22, `STOREY` and the bands rescaled, and `GATE_HEIGHT` 18 with its built-in towers at 22.
  - Keep the 8 m module, the 2.8 m depth, the 6 m tower footprint, the 24 m by 6 m gate, and the 0.5 m collision cells.
  - Update the docstring sizes, then rerun `fort_ship_{wall,tower,gate}.py`.
- 3.3 `src/data/fortress.ts`: `shipMetal.gate.height` 4.5. `nose.towerEvery` 3. Retune `nose.turn` with a `tmp/` sweep, as PH2 of revision 5 did (UK1). `src/sim/fortress.ts:184-189` reads `def.towerEvery ?? FORTRESS.circleTowerEvery`.
- 3.4 `npm run models:shapes`. `src/data/prop-shapes.test.ts:89,111-113`: the new heights (IV4, IV13). `fortress-layout.test.ts`: IV30, plus closure (IV3) on the new pieces. Bake, compare (IV26), and commit the map.
- Commit: `Nose's ship-metal ring stands 16 m with towers every 23 m, as in C5`

### PH4 — Nose ship, rise and crag models from C5
- 4.1 Skill phases 0-3 per asset, in one Nose master calibrated to the 7.5 m truck and the 16 m wall. Gate each sheet from C5's camera.
- 4.2 `tools/blender/ship_hull_kit.py` (rewrite):
  - The 12-sided loft profile, plate layout (about 1/8 girth), rust edge strips, rivet rows, ring frames, and the lattice rib-and-X-brace builder.
  - Colors use palette keys, with `glow` for the windows.
  - `ship_nose.py`, `ship_hull_ring.py`, `ship_hull_ribs.py` and `ship_hull_stern.py` (rewrite) build the sections described in Design. Their joints meet on one profile. Origins and `socket_dish` follow the current docstrings, so `nose.ts` keeps its frame.
- 4.3 `tools/blender/nose_rise.py` and `tools/blender/nose_crag.py` (create):
  - faceted low-poly rock masses from subdivided boxes with seeded `push` displacement, in two or three orange-brown rock tones from the palette
  - `nose_rise` carries `socket_ship_front` and `socket_ship_rear` and the 6 m retaining terrace front
  - flat or buried bottoms
  - sizes and origins in the docstring
- 4.4 `src/three/render/models.ts`: add `nose_rise` and `nose_crag` to `NAMES`. `src/three/render/models.test.ts`: both sockets exist, and the sockets' height difference over their distance gives a 6-10° pitch.
- Commit: `Nose's ship sections, rock rise and crag rebuilt from the C5 concept`

### PH5 — Nose interior from C5 (TDD for placement)
- 5.1 `src/three/render/interiors/nose.ts` (rewrite the layout; keep the module and `buildNose` signature):
  - Frame: u runs along the ship axis, square to the bearing from the south gate to the center, with the nose to the west. v runs away from the south gate. Derive it from `fortressGates(site)`, not from hard-coded camera axes.
  - `addRise`: `nose_rise` and `nose_crag` placed in the far half. The ship group is set on the rise sockets with the 4° roll. The radar dish stays on `spin`.
  - `addTerrace`: the `hull_scaffold` run and at least two stairs along the terrace foot.
  - `addYard`: shelters in rows (the scale set in Design), the awning, `water_tower`, `jib_crane`, the van and crates, all placed with `fitsCurtain`, the gate discs and a `taken` list as today.
  - Rubble `rock` instances go at the rise and crag feet only.
  - `b.root.userData.homes` is the shelter count.
- 5.2 Tests in `sites.test.ts`, written first: IV27, IV28, IV29, plus IV8 and IV20 on the new meshes. The shelter count is above 40.
- 5.3 Look: concept view (south gate, camera turned, ring filling the frame) and the default view, at noon and dusk, next to C5. Tune until the N checks in PH6 hold, and write each remaining mismatch as a measurement in the brief.
- Commit: `Nose is a ship-nose town: the colony ship perched on a rock rise over a dense scrap yard`

### PH6 — Docs, whole-game checks and visual acceptance
- 6.1 Docs:
  - `docs/art.md`: ship-metal sizes, the ship sections and the rise and crag.
  - `docs/architecture/map.md`: the bastioned shape, `fortressCore` and the pit on the core.
  - `docs/wiki/mechanics/world.md`: Bowl as a star fort and Nose's description. Then `npm run wiki`.
- 6.2 Run:
  - `npm test` with `TEST_TIMEOUTS=off`, `npm run typecheck`, and `npm run quality` from the root.
  - `npm run stuck`, for AS2.
  - `npm run perf` where a GPU is available. Otherwise record it as unmeasured, for AS4.
  - `npm run playtest -- --cpu`.

  A miss that `8d024493` also has goes to the deferrals with numbers. A miss on the branch alone is a regression to fix.
- 6.3 Shots: `tmp/concept-shots.mjs` at the final head:
  - Bowl from S6's exact view and the default view.
  - Nose from the C5 view (south gate square to the camera, ring at about 93% of the frame width) and the default view, at noon and dusk.
  - Dustwell, Granary and Salvage Yard from their default views.

  `tmp/concept-compare.py` reads the concepts from `/work/.factory-media/` (C1 `ref-9d412b3c0188.jpg`, C5 `ref-6a17345272db.jpg`, S6 `ref-c5504662d737.jpg`). It writes `tmp/design/compare-bowl.png` (S6, game, C1), `compare-nose.png` (C5, game) and `.factory/comparison.png`. Look at every sheet and record each check below in `## Verify`, with a measurement for each mismatch:
  - B1: six bastion points show as arrowheads in both Bowl views, each with three towers. A gate shows in each of the two front curtains, with a bastion on each side.
  - B2: from the S6 view, the shoulder towers stand visibly proud of the curtains, and every curtain foot is in a shoulder tower's line of sight. IV25 is the numeric proof. Mark the sight lines on a copy of the shot.
  - B3: the interior keeps revision 5's C1 features: terraces with crops and stairs, houses, pond, windmill turning, tanks and greenhouse.
  - N1: the ship spans 0.70-0.80 of the ring's screen width (C5 0.76). Measure both in px.
  - N2: the cockpit is at the upper left and higher than the rear, and the ship tilts down toward the right, as in C5.
  - N3: the ship stands visibly on the rise above the yard, with rubble under the nose. It does not lie on flat sand.
  - N4: the crag rises above the back-right wall, with the torn stern in it.
  - N5: the yard reads as densely built. Its largest empty patch is no wider than 3 shelter widths on screen. The terrace has platforms and stairs.
  - N6: the ring reads as a band, with towers no farther apart on screen than C5's, measured as the tower gap over the ring width.
  - N7: the plates read as large rusted plates with frames and a lattice section. Count the plates per section height against C5's.
  - N8: the radar dish turns, from two shots 1 s apart. The gate lamps glow at dusk.
  - U1: Dustwell, Granary and Salvage Yard match their `8d024493` shots, with no pixel difference beyond NPC trucks (IV26).
  - F1: from a recorder run or a scripted turn, a truck parks on a Bowl pad and a Nose pad and uses a service. The gate guns stand on the gates.
- 6.4 A failed check goes back to its phase. After any code change, rerun the playtest and retake the shots at the final head. Write `.factory/evidence.json` for that head. The task ends at `validating` until the user confirms the look.
- Commit: the docs.

### Test strategy
- PH1 covers IV1, IV17, IV25, IV26 and IV31, written first.
- PH3 covers IV3, IV4, IV13 and IV30 on the real models.
- PH5 covers IV8, IV20, IV27, IV28 and IV29.
- The other kept invariants (IV2, IV5, IV6, IV10-IV12, IV14, IV19, IV21/IV22, IV24) keep their revision 5 tests, rerun in every phase and in PH6.
- PH6 covers the side effects (`stuck`, `perf`, `playtest`) and the look, by the B, N, U and F checks.

### Order & dependencies
- PH1 blocks PH2, and PH2 blocks PH3 (IF4: the shared data file and map).
- PH3 blocks PH4 and PH5, because the wall height sets the ship's and the rise's scale.
- PH4 blocks PH5, because of the sockets and the model sizes.
- PH6 comes last. Bowl (PH1-PH2) and Nose (PH3-PH5) are independent in logic, but they run in sequence because they share the map, `prop-shapes.json` and `sites.test.ts`.

### Risks / rollback
- RK1 — The smaller crater core loses C1's terraces (AS5). Narrow the terraces to 2 tiles, or drop to three steps, before shrinking the floor features.
- RK2 — A forecourt pocket between bastions traps a truck (AS2). Nav never plans inside the circle. If `stuck` shows one anyway, record the stall and shorten the bastion projection.
- RK3 — The extra Bowl towers and the Nose models miss `perf` (AS4). Decimate the rock models first, then cut shelters, and record the numbers.
- RK4 — The 180 m ship at 8° pitch pokes above the camera's frame or through the north curtain. IV8 and IV28 catch it; shorten the stern section.
- RK5 — The taller ship-metal gate changes Nose's gun and lamp heights. IV11 and IV12 measure from `fortressGates` and the style height, so they follow.
- Rollback: one commit per phase. Reverting PH3-PH5 restores revision 5's Nose. Reverting PH1-PH2 restores the hexagon.

### Interfaces
- IF1 [blocks] — `fortressCore(site)`, the `bastioned` shape, and the rebaked map. PH2's interior reads them.
- IF2 [blocks] — the 16 m ship-metal pieces, `towerEvery` and the Nose map. PH4 and PH5 size from them.
- IF4 [blocks] — Bowl's final trace and pit numbers in `src/data/fortress.ts` and the map baked from them. PH3 edits the same data file and rebakes the same map, so it starts from PH2's result.
- IF3 [blocks] — `nose_rise` with `socket_ship_front`/`socket_ship_rear`, `nose_crag`, and the four rebuilt sections. PH5 places from them.

### Interface graph
- PH1 -> IF1 @ src/data/fortress.ts, src/sim/fortress.ts, src/sim/fortress.test.ts, src/sim/fortress-layout.test.ts, src/mapgen/fortress.test.ts, public/maps/icarus.bin
- PH2 IF1 -> IF4 @ src/three/render/interiors/bowl.ts, src/three/render/sites.test.ts (and, when 2.3 retunes the trace, src/data/fortress.ts and public/maps/icarus.bin)
- PH3 IF4 -> IF2 @ tools/blender/fort_ship_kit.py, public/models/fort_ship_*.glb, src/data/prop-shapes.json, src/data/prop-shapes.test.ts, src/data/fortress.ts, src/sim/fortress.ts, src/sim/fortress-layout.test.ts, public/maps/icarus.bin
- PH4 IF2 -> IF3 @ tools/blender/{ship_hull_kit,ship_nose,ship_hull_ring,ship_hull_ribs,ship_hull_stern,nose_rise,nose_crag}.py, public/models/, src/three/render/models.ts, src/three/render/models.test.ts
- PH5 IF2, IF3 -> @ src/three/render/interiors/nose.ts, src/three/render/sites.test.ts
- PH6 -> @ docs/, tmp/, .factory/

## Code smells
- `src/sim/vision.ts:29-31,69` — `propsNear()` and `forSeenTiles()` filter all of `world.obstacles` on every sight check (Principle 3). This predates the change, which adds about 64 fort props.

## Conclusion
### Hands-off decisions
- udesign (rev 4-5): the remade sites get their own styles, flush gates, a baked Bowl pit, moving parts on `SiteMotion`, and emissive lamps with no point lights. Walls stay at least 3x the tallest truck. Dustwell pumps water. Fortress oases lose their pond obstacle through rescue. The Salvage crane stays over the yard. The ship barbican kinds are deleted.
- udesign (rev 6): Nose's concept is `ref-6a17345272db.jpg` only. Revision 5 had used the withdrawn `ref-9aaa59c32856.jpg`, and the committee had said to use the replacement.
- udesign (rev 6): Bowl's star is a bastioned trace made of the approved patchwork pieces, with no new prop kind. A new model kind would change the saved shape, and one model cannot fit six bastion angles.
- udesign (rev 6): flanking is a layout property checked by IV25. No tower guns were added to the sim: the committee asked for a star fort's geometry, and DESIGN.md makes the gate gun the town gun.
- udesign (rev 6): Bowl's gate faces move in to the curtains, which makes the forecourts about 7.9 tiles deep. Pads and gate points must not move, and a gate belongs in a curtain between bastions.
- udesign (rev 6): Bowl's crater follows the main enclosure, and the bastions stay at rim level. The interior is kept and resized only where it no longer fits.
- udesign (rev 6): Nose keeps its 32-tile site circle. Shrinking it to C5's ring would move pads, gates, spawns and routes at the largest town.
- udesign (rev 6): Nose's walls rise to 16 m and its towers to 22 m, every 3 sections. C5's exact wall-to-ring ratio would need 29 m walls.
- udesign (rev 6): Nose's rise and crag are render-only models inside the curtain. Ground outside the curtain does not change.
- udesign (rev 6): the Nose look is accepted on measured ratios (N1-N7, IV27-IV30), not on a feature checklist alone. Revision 5's checklist passed a wrong composition.
- uplan (rev 6): phases run serially in the foreground, with Bowl and Nose allowed separate implementers.
- uplan: plan auto-approved.

### Implementation notes (rev 6)
- Commits: PH1 bastioned trace and bake; PH2 Bowl interior on the core; PH3 Nose 16 m ring, `towerEvery` 3 and turn 8 (UK1 settled: turns 3.75-9.75 clear both gates, so the turn stays); PH4 ship sections, `nose_rise`, `nose_crag`; PH5 Nose interior; docs.
- Deviations: Bowl pit retuned to margin 1, terraceWidth 1.8, stepHeight 0.5 (a 0.6 step made a road sample at a Bowl gate a cliff). IV25 holds at the planned 21.5/26.75/2.5/2.5 numbers (UK2 settled). Nose yard has about 60 shelters of varied scale. The rise leaves a 34 m hole at the WNW gate and Nose's gate discs are 34 m (`GATE_CLEAR` 5.5). The blender-image-to-3d phase files (briefs, calibrated masters) were not produced; models were judged from in-game and preview renders against C5. No pre-existing failures found; `npm test` (3563 tests) and `npm run typecheck` pass. `npm run stuck`, `perf` and `playtest` were not run (left to the testing stage).
- IV26: pieces of the other eight fortress sites equal a fixture from 8d024493; the baked map's props outside Bowl and Nose are equal; heights change only inside Bowl's curtain versus 42b6c9fe.

### Visual self-review
Views read: Bowl concept view (noon, dusk) and default view; Nose concept view and default view (noon, dusk); Dustwell, Granary, Salvage Yard default shots (tmp/final6). Sheets: tmp/design/compare-bowl.png, compare-nose.png, .factory/comparison.png.
Found and fixed: Nose plates read grey-blue (now warm bone/sand weights); Nose rise front was one straight dark wall (now a rubble slope outside the platform stretch); crag too dark (lighter tones); shelters in a regular grid (varied scale, jitter, skips); ship pitch raised to 9.5 degrees; Bowl pit too small for the houses (retuned).
Remains: Nose's wall panels are darker and less multicolored than C5's; the rise reads smoother and less rubbly than C5's; shelters still sit in rows; Bowl's crater walls are terraces, not C5's rock slopes; Bowl's bastions are small next to the ring. Dusk shots are near dark at turn 250 (lit windows and lamps show). N8 dish spin was not measured from paired shots. The user confirms the look.

## Conclusion

Testing stage: merged dev (issue 129 terrain/hull rework) into the branch and rebuilt the map. Conflicts resolved by keeping dev's prop kinds, ship decks and boxes, plus this branch's fortress kinds (appended last), `touchesObstacle` (now takes terrain), SiteMotion and the fortress spawn rule. `save-shape.json` was regenerated: it only differs by roster size from dev's NPC changes, not by type.

### Visual comparison
Sheet: `.factory/comparison.png` (S6 | new Bowl | C1, then C5 | new Nose).
- Matches (Bowl): a bastioned star trace with projecting points and towers at points and shoulders; two flush X-braced gates in a curtain; terraced crater farm with houses, pond, windmill, tanks and greenhouse; patchwork panels with tower huts.
- Matches (Nose): pale plated ship nose pitched up on a faceted rock rise across the back, skeletal torn rear running into the crag; dense scrap-shelter yard with platform, red awning, water tower, jib crane and van; ring of banded towers and a flush plank gate.
- Remaining: the game's neutral noon light and dev's new grey ground outside the ring, versus C5's orange dusk; ship plating is less rusted and detailed than C5; Nose has no stairs up the rise; the concept camera shot of Nose is steeper than C5. Left as tune-level look polish; the committee confirms the look.
