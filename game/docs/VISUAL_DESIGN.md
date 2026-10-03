# Icarus landmarks

Recognizable destinations interrupt long stretches of damaged farmland and rough roads. Concept-derived tags: broken farm grid, exposed ship ribs, reclaimed water.

## Physical scale

- One tile is four metres. The pickup body is 5.2 metres long. Buildings and destinations use that scale rather than growing the vehicle to fill the screen.
- Bowl occupies a 224-metre-wide footprint and Nose a 256-metre-wide footprint. Both contain inhabited blocks with one- and two-storey houses, doors, windows, rooftop water tanks, and clear road approaches. Inhabited sites stand behind fortress curtains: walls at least three times a truck's height, corner towers or star bastions, and a shut gatehouse at each road gate. Masonry curtains are pale stone, Nose's is ship metal, and the salvage and raider curtains are scrap plate over basket tiers topped with wire. Interiors remain non-drivable.
- Houses measure 10.8 by 8.4 metres on 20-metre blocks. Old Orchard spreads over a basin about 430 by 330 metres, its edge following the ridges and roads, crossed by a 12-metre old road and four broad dirt roads. Its 15 blocks of dead trees stand in rows 12 metres apart, with trees 6 metres apart along a row and crowns about 6.5 metres wide. Its buildings stand at real size against an 8-metre army truck: the 26-metre farmhouse, the 24-metre barn and the 22-metre Quonset hangars.
- Fallen Sun's wreck lies in pieces along a crash line about 350 metres long. Its largest piece, the bow, is 88 metres long and 36 metres wide. The reactor core is about 24 metres across. Nose's hull section is 88 metres long with a projecting bow. Ship fragments remain larger than the buildings built around them. Broken Wing is a crashed ship's wing: a 156-metre by 24-metre deck of light plating with rust patches and a dirt track, an edge beam with a bent lip, dark X-braced lattice reaching 8 metres down and five slanted plated pylons on each side. At its root a hoop about 35 metres across and 31 metres high, the wing's torn root, is plated on the outside with dark ribs and lattice inside.

## Materials and shapes

- Warm sand and stone form the background. Winding roads retain broad rises and falls instead of flattening the whole basin.
- Cold metal identifies ship debris and machinery. Fallen Sun is one broken hull along a crash line: tilted hull decks under exposed ribs, a wall of plating rolled onto its side, thrown plates, and the glowing reactor in the split engine core. Nose combines hull shelter with buildings.
- Muted green identifies surviving vegetation. Old Orchard has short, wide-crowned dead trees in rows on darker field ground, frayed by single trees between the blocks, blue-grey concrete irrigation canals beside the road and between the blocks, broken wooden fences and pale dirt roads and tracks. Military buildings surround a ruined farmhouse: a sandbagged concrete blockhouse, rusty Quonset hangars, gabled barns, a concrete motor pool of army trucks parked askew, guard huts with sandbag corners, and concrete barriers shoved askew along the road. Drums, lumber, junk and loose sandbags lie scattered round the buildings, never in rows. No disc or round clearing marks its edge.
- Blue-green marks water at Bowl, Dustwell, Green Pit, and South Lock. Glass Flats uses shallow angular fragments rather than a building.
- Rust marks damaged equipment, wrecks, gates, and salvage stock. The Granary has silos and a ruined loading shed. Pump Station has tanks, pipes, and valves. Salvage Yard has sorted stock, sheds, and a lifting beam. Raider camps have a scrap-and-basket curtain with gate towers, scrap shacks around a fire pit, fuel tanks and a stripped hull.

## Readability

- The player truck and its selection ring stay the moving focal point. Dense detail belongs inside destination footprints, away from road approaches.
- Sites use separate silhouettes: planted rows, silos, hull sections, gates, wells, and pod clusters. Labels identify places but do not supply their entire identity.
- Distant terrain is split into chunks so offscreen geometry can be culled. The ground texture is bounded to 2048 pixels per side. A site is discovered when any of its tiles comes into sight.
- Fallen Sun's ribs, plating walls, debris and reactor, machinery, Old Orchard's farm and army buildings, trees, rocks, wrecks and town ring buildings are low-poly Blender models from `tools/blender/`. Houses, ruins, water, the smaller hull sections at other sites and the Fallen Sun's hull deck plating are built from Three.js shapes in code. The plating lies on the decks baked into the ground, with panel seams, a torn high end and skirts over the steep edges.
