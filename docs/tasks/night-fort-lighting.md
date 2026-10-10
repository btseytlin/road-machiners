# Night fort lighting

**Status:** executing
**Branch:** factory/issue-402
**Worktree:** .worktrees/issue-402
**Goal:** At night every fort reads as lived in: warm amber pools on its ground and wall faces around many small glowing lamps, no light crossing a wall, 4 lamps outside on each tower and none on outer walls, and the night frame stays inside `scripts/perf-budgets.json`. The user confirms the look on night captures of Bowl and Salvage Yard.
**Mode:** interactive

## Context
- Forts are lit by a pool of 12 real spot lights in `siteLights.ts`. Each real light costs shading on every fragment, so a fort can afford only a few, and they read as flashlight blobs.
- Lamp heads in `sites.ts` are emissive boxes that light nothing. Inner wall lamps hang every 3 wall pieces. Outer lamps hang on camera-facing faces of walls, towers and bastions, about 2 per tower.
- Two shadowed `facade` spot lights stand outside each fort to light its front. They light the ground apron in front of the fort too brightly.
- All site, model and terrain materials are `MeshLambertMaterial`. The terrain material already chains two shader hooks, `facetGround` and the fog `greyOut`.
- Fort walls and towers are map props drawn by `obstacles.ts` from Blender models. Interior buildings come from `SiteBuilder`.
- `insideCurtain` puts a wall's own footprint outside the curtain. Only points more than half a wall depth inside the outline count as inside.
- ACES tone mapping in `game.ts` turns the amber light pink grey.
- The map is 600 tiles wide. There is no post-processing pipeline. Outlines use stencil bits and antialiased edges.
- `sites.test.ts` no longer compiles: it still names the removed `sconce` and `wall` light kinds. `render.md` still describes them.

## Design
Fake most fort light the way games do, and keep real lights only where they must move or cast shadows.

Baked light pools. At build time every fort lamp bakes a soft warm pool into one single-channel world texture at 4 texels per tile, 2400 by 2400. A texel takes light from a lamp only when both sit on the same side of the curtain: inner lamps light inside texels, outer lamps light texels beyond the wall. Wall footprint texels stay dark, so wall roofs stay dark. A shader hook adds `diffuse colour × pool × amber × night level` to the emissive term. The hook samples at the fragment's world xz pushed half a tile along its world normal, so an inner wall face reads inside texels and an outer face reads outside texels. The hook goes on the terrain material, the `SiteBuilder` materials and the fort piece model materials only. On terrain it adds the pools after `greyOut`, so pools inside sight stay warm and greyed ground stays grey.

Lamp halos. Each lamp head gets an additive billboard sprite with a soft radial glow. This replaces the agreed bloom pass. Bloom needs a post-processing pipeline that would move tone mapping, the stencil outlines and the antialiasing onto render targets. Sprites give the halo with none of that risk.

Night level. `SiteLights` owns one night level from 0 to 1. It ramps over `SITE_LIGHT_FADE_S` when night starts or ends, and it drives both the pool uniform and the halo opacity. Pools and halos switch on for all forts together. Real lights keep their per-site stagger.

Lamp mounts. One list of lamp mounts per fort, taken after `pullInside`, feeds the lamp meshes, the halos and the bake. Outer lamps hang on all 4 faces of every tower and nowhere else. Inner lamps stay on walls every 3 pieces.

Real lights. Keep gate, fill, flood, wash, fire and window. Remove the `facade` kind and its constants. The fill keeps its shadow slot.

Colour curve. A last, separate phase tries AgX tone mapping in place of ACES. It changes the whole game's day look, so it lands only after the user approves day and night captures before and after.

Reflections are out of scope.

TDD: yes for the bake and the mount list, which are pure functions. No for the shader hook, halos and tone mapping, which are checked on captures.

### Invariants
- IV1 — A baked texel inside the curtain gets zero light from any outer lamp, and a texel outside gets zero from any inner lamp. The test samples with bilinear filtering at points on both wall faces.
- IV2 — Every tower carries exactly 4 lamps, one per face. Walls and bastions carry no lamps on their outer faces.
- IV3 — Lamp meshes, halos and baked pools come from the same mount list, so each pool has a lamp and each lamp has a pool.
- IV4 — Startup fails loudly when the renderer's max texture size is below the pool texture size.
- IV5 — No `facade` light kind remains, and a fort never registers more real lights than the pool.

### Principles
- PC1 — A new night effect is baked or drawn as a sprite. It does not add a real light unless it must cast a shadow or move.

### Assumptions
- AS1 — "Only 4 at each tower" means 4 lamps on every tower. The user has not confirmed this reading.
- AS2 — Fort piece models come from a small set of model names that `obstacles.ts` can tag for the hook.
- AS3 — A 5.8 MB single-channel texture and one extra texture fetch per hooked fragment fit the frame budget.

### Unknowns
- UK1 — Pool radius and strength that match the concept image. Tuned on captures.
- UK2 — Whether the fort piece model normals are flat per face, so the half-tile push picks the right side.
- UK3 — Whether the user keeps AgX after seeing day captures.

## Plan

Approach: one new render module owns the pool texture, its shader hook and the halo material. Sites register lamp heads, game.ts bakes once at startup and drives the night level each frame. The user approved the design with "do it", so execution follows without a separate plan approval.

### PH1 — Bake and hook module
- 1.1 `game/src/three/render/lightPools.ts` (create)
  - `type PoolLamp = { site: Site; x: number; z: number; inside: boolean }` in tiles.
  - `bakePools(lamps: PoolLamp[], worldSize: number): Uint8Array` returns one byte per texel at `POOLS.texelsPerTile`. A texel takes a lamp's falloff only when `insideCurtain` of the texel equals the lamp's `inside`, and an outside texel also needs to be beyond the wall band. Respects IV1.
  - `poolTextureSize(worldSize: number, maxTextureSize: number): number` throws above the renderer limit. Respects IV4.
  - `NightPools` holds the uniforms, the `DataTexture` and the halo `SpriteMaterial`. Methods: `bake(lamps, worldSize, maxTextureSize)`, `setLevel(level)`, `light(material)` chains `onBeforeCompile` and adds `diffuseColor × pool × amber × level` before `#include <tonemapping_fragment>`, sampled at world xz pushed `POOLS.push` tiles along the world normal. `halo(): THREE.Sprite`.
  - One module instance `NIGHT_POOLS`, because terrain, obstacles and sites build materials in separate places. Deviates from GPC1 to avoid threading one object through three constructors and their tests.
- 1.2 `game/src/three/render/lightPools.test.ts` (create): IV1 on a real fort with bilinear sampling on both faces of a wall, IV4.
- Commit: Bake fort lamp light into a world pool texture with a shader hook

### PH2 — Lamp mounts, halos and real lights
- 2.1 `game/src/three/render/sites.ts`
  - `SiteBuilder.lamps: THREE.Mesh[]`, filled by `addLampHead`.
  - `wantsSconce`: towers take all 4 faces. Walls take inner faces every 3 pieces when the throw point is inside. Bastions take none. Respects IV2.
  - Remove `addFacadeLights` and `FACADE`.
  - `buildSite` gives each fortress lamp head a halo child and returns `PoolLamp`s read from the head world positions after `pullInside`. `addSites` and `buildSites` return the lamps. Respects IV3.
  - Hook every `SiteBuilder` material and site model material of a fortress with `NIGHT_POOLS.light`.
- 2.2 `game/src/three/render/siteLights.ts`: drop the `facade` kind. `SiteLights` ramps a night level over `SITE_LIGHT_FADE_S` and exposes it. Respects IV5.
- 2.3 `game/src/three/render/obstacles.ts` `buildProp()`: hook fort piece model materials, found through `FORT_MODELS`.
- 2.4 `game/src/three/render/terrain.ts` `terrainMesh()`: hook the ground material.
- 2.5 `game/src/three/game.ts`: bake after `addSites`, call `NIGHT_POOLS.setLevel` after `siteLights.sync`.
- 2.6 `game/src/three/render/sites.test.ts`: replace the sconce and wall kind tests with IV2, IV3 and IV5 tests.
- 2.7 `game/docs/architecture/render.md`: describe pools, halos and the remaining real lights.
- Commit: Light forts with baked lamp pools and halos, 4 lamps per tower, no facade lights

### PH3 — Tune on captures
- Tune `POOLS` radius and strength and the halo size on night captures of Salvage Yard. Resolves UK1, UK2. Run `npm run perf` for AS3.
- Commit: Tune fort night pools

### PH4 — AgX trial
- `game.ts:212` switches to `THREE.AgXToneMapping`. Day and night captures before and after go to the user. It lands only on approval. Resolves UK3.

### Test strategy
- Failing tests first for `bakePools` and the mount rules, then the code.
- Run only `lightPools.test.ts`, `sites.test.ts`, `siteLights.test.ts` and `terrain.test.ts`, then `npm run quality`.

### Risks / rollback
- RK1 — The pool hook and `greyOut` both edit the terrain fragment shader. The pool code sits at `tonemapping_fragment`, after the greyOut code, whatever order the hooks chain in.
- RK2 — One extra texture fetch on every hooked fragment may push Bowl past the frame budget. `npm run perf` checks it, and the pool texture can drop to fewer texels per tile if needed.
