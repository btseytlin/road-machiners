"""Fallen Sun wing flap: a torn wing flap propped up as a jump ramp, a tilted plate on a bent strut wedge.

Reference size: 20 m long along X (the flaps' 5 tiles), 12 m wide along Y (3 tiles) and a rise of 1.4 m at the lip
(0.35 height units of 4 m). The origin is the plate top's center and the plate top is z = 0, as in wing_deck.py, so
the view poses it with poseOnDeck: pitched along the deck, and stretched to each flap's length, width and rise. The low
end, with the hinge, is at -X, and the lip at +X. The wedge is built in the plate's frame, so the ground lies on
the line from z = 0 at the hinge to z = -RISE at the lip, and the skids and feet bury 0.3 m under it. The size is
inferred: neither reference image shows a flap.
- The top is hull plating in panels with dark seams and rust patches. Nothing stands proud of z = 0, and the lip is a
  clean edge beam, so trucks leave it as drawn.
- Under it, bent legs prop the lip, braces run back to the hinge, and torn side gussets close the wedge.
Run: blender --background --python tools/blender/ship_flap.py -- public/models/ship_flap.glb [tmp/ship_flap.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 82

LENGTH = 20.0  # the flaps' 5 tiles
WIDTH = 12.0  # the flaps' 3 tiles
RISE = 1.4  # m at the lip, 0.35 height units
HALF_L, HALF_W = LENGTH / 2, WIDTH / 2
SLAB = 0.35  # plate thickness
PANEL = (2.5, 3.0)  # panel along and across: 8 along, 4 across
SEAM = 0.14
BURY = 0.3  # how far skids and feet reach under the ground line
LEG_XS = (HALF_L - 0.7, HALF_L * 0.25)  # legs at the lip and part way back
LEG_YS = (-HALF_W + 1.2, 0.0, HALF_W - 1.2)
SKID_FROM = -HALF_L * 0.3  # the skids start where the ground lies under the slab


def ground(x: float) -> float:
    """The ground line under the plate, in the plate's frame."""
    return -RISE * (x + HALF_L) / LENGTH


def plate(kit: Kit) -> None:
    """The plate: a dark slab with hull panels on top, rust patches, a clean lip beam and the hinge."""
    kit.box("slab", (LENGTH, WIDTH, SLAB - 0.1), (0, 0, -SLAB / 2 - 0.05), "hull_dark")
    along, across = int(LENGTH / PANEL[0]), int(WIDTH / PANEL[1])
    rust = [(kit.rng.uniform(-HALF_L + 2, HALF_L - 2), kit.rng.uniform(-HALF_W, HALF_W), kit.rng.uniform(2, 4), kit.rng.uniform(1.2, 2.5)) for _ in range(2)]
    for i in range(along):
        x = -HALF_L + PANEL[0] * (i + 0.5)
        for r in range(across):
            y = -HALF_W + PANEL[1] * (r + 0.5)
            if any(((x - px) / ax) ** 2 + ((y - py) / ay) ** 2 < 1 for px, py, ax, ay in rust):
                mat = "rust" if kit.rng.random() < 0.7 else "rust_side"
            else:
                mat = "hull_grey" if kit.rng.random() < 0.2 else "hull"
            kit.box(f"panel_{i}_{r}", (PANEL[0] - SEAM, PANEL[1] - SEAM, 0.12), (x, y, -0.06), mat, dent_by=0.02)
    # A clean beam along the lip, flush with the top, and dark rails along both sides.
    kit.box("lip", (0.5, WIDTH, SLAB + 0.25), (HALF_L - 0.25, 0, -(SLAB + 0.25) / 2 - 0.005), "hull_grey")
    for side in (-1, 1):
        kit.box(f"rail_{side}", (LENGTH, 0.3, SLAB + 0.1), (0, side * (HALF_W - 0.15), -(SLAB + 0.1) / 2 - 0.005), "hull_dark")
    # The hinge at the low end, half sunk in the ground.
    kit.cylinder("hinge", 0.35, WIDTH - 0.6, (-HALF_L + 0.2, 0, -SLAB), "rust_dark", rot=(math.radians(90), 0, 0), vertices=6)


def wedge(kit: Kit) -> None:
    """Bent legs under the lip and part way back, skids on the ground, braces and torn side gussets."""
    bottom = -SLAB
    for y in LEG_YS:
        # A skid along the ground line under the lip half, where the ground lies clear under the slab.
        strut(kit, f"skid_{y:.0f}", (SKID_FROM, y, ground(SKID_FROM) - BURY * 0.5), (HALF_L - 0.3, y, ground(HALF_L - 0.3) - BURY * 0.5), 0.4, "rust_dark")
        for k, x in enumerate(LEG_XS):
            foot = (x - 0.5, y, ground(x - 0.5) - BURY)
            top = (x, y, bottom)
            knee = (x + 0.35 + kit.rng.uniform(0, 0.25), y + kit.rng.uniform(-0.15, 0.15), (foot[2] + bottom) / 2)
            strut(kit, f"leg_{k}_{y:.0f}_low", foot, knee, 0.4, "rust_dark", dent_by=0.03)
            strut(kit, f"leg_{k}_{y:.0f}_high", knee, top, 0.4, "rust_dark", dent_by=0.03)
        # A brace from the lip leg's foot back up to the plate.
        x0 = LEG_XS[0] - 0.5
        strut(kit, f"brace_{y:.0f}", (x0, y, ground(x0) - 0.1), (HALF_L * 0.25 - 2.5, y, bottom), 0.3, "rust_dark")
    # Side gussets: torn triangular plates closing the wedge under the lip half.
    for side in (-1, 1):
        y = side * (HALF_W - 0.4)
        x_tear = kit.rng.uniform(-1.0, 1.0)
        profile = [
            (x_tear, bottom),
            (HALF_L - 0.5, bottom),
            (HALF_L - 0.5, ground(HALF_L - 0.5) - BURY),
            (x_tear + 3.0, ground(x_tear + 3.0) + 0.1),
        ]
        mat = "hull_grey" if side < 0 else "rust_side"
        prism(kit, f"gusset_{side}", profile, y - 0.06, y + 0.06, mat)


def build(kit: Kit) -> None:
    plate(kit)
    wedge(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_flap", args, view_size=26)


if __name__ == "__main__":
    main()
