"""Small concrete guard booth of the old army farm, with a flat overhanging roof and a window band.

Built to a 0.8-tile reference radius, 3.2 m: a 2.4 m square booth, 3.0 m tall to the tip of its low pyramid cap,
under a 3.0 m roof slab, with two sandbags by the door. The door faces +X.
Run: blender --background --python tools/blender/guard_post.py -- public/models/guard_post.glb [tmp/guard_post.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "concrete": 0xB89A74,  # PAL.wall.top
    "concrete_side": 0x8E7454,  # PAL.wall.side
    "roof": 0x9A8A78,  # PAL.rock.top
    "dark": 0x2A1A10,  # PAL.shadow
    "bag": 0x7C7442,  # PAL.scrub[2]
    "bag_dark": 0x5E6038,  # PAL.nose.top, olive drab
}
SEED = 67
HALF = 1.2  # m, half the booth's side
SILL = 1.0  # m, top of the solid lower walls
EAVE = 2.5  # m, underside of the roof slab


def build(kit: Kit) -> None:
    # Dark inside, seen through the window band and the door.
    kit.box("inside", (2 * HALF - 0.2, 2 * HALF - 0.2, EAVE), (0, 0, EAVE / 2), "dark")
    # Solid lower walls on three sides. The front wall leaves a door gap on its -Y half.
    kit.box("wall_back", (0.2, 2 * HALF, SILL), (-HALF + 0.1, 0, SILL / 2), "concrete_side", dent_by=0.02)
    for s in (-1, 1):
        kit.box(f"wall_side{s:+d}", (2 * HALF, 0.2, SILL), (0, s * (HALF - 0.1), SILL / 2), "concrete", dent_by=0.02)
    kit.box("wall_front", (0.2, HALF, SILL), (HALF - 0.1, HALF / 2, SILL / 2), "concrete", dent_by=0.02)
    kit.box("lintel", (0.2, HALF, 0.3), (HALF - 0.1, -HALF / 2, EAVE - 0.15), "concrete")
    # Corner posts carry the roof over the window band.
    for x in (-1, 1):
        for y in (-1, 1):
            kit.box(f"post{x:+d}{y:+d}", (0.28, 0.28, EAVE), (x * (HALF - 0.14), y * (HALF - 0.14), EAVE / 2), "concrete_side")
    # Flat roof slab overhanging every side, with a low pyramid cap on top.
    kit.box("roof", (3.0, 3.0, 0.22), (0, 0, EAVE + 0.11), "roof", dent_by=0.03)
    cap = kit.cylinder("cap", 1.45, 0.3, (0, 0, EAVE + 0.37), "concrete", rot=(0, 0, math.radians(45)), vertices=4)
    taper(cap, 0.15)
    # Two sandbags against the front wall beside the door.
    for i, y in enumerate((0.45, 0.95)):
        kit.box(f"bag{i}", (0.5, 0.48, 0.3), (HALF + 0.3, y, 0.15), "bag" if i else "bag_dark", rot=(0, 0, 0.1 * i), dent_by=0.03)
    kit.box("bag_top", (0.5, 0.48, 0.28), (HALF + 0.3, 0.7, 0.43), "bag", dent_by=0.03)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("guard_post", args, view_size=7)


if __name__ == "__main__":
    main()
