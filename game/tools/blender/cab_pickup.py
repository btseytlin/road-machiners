"""A boxy closed cab on its own, drawn only for the cabPickup icon. The truck view draws the cab from its base model.

Footprint is 3x2 cells, 1.45 m across by 1.3 m along. Painted doors to the 0.5 m beltline, one dark glass band, a rear window, a raked
windshield and a trim roof at 1.2 m, like the scout's cab. The windshield faces +X.
Run: blender --background --python tools/blender/cab_pickup.py -- public/models/cab_pickup.glb [tmp/cab_pickup.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import CELL_ACROSS, CELL_ALONG, Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS  # noqa: E402
from parts_common_core import check_footprint  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 640
FRONT = CELL_ALONG - 0.02  # 2 cells along, so the half length is one cell
BACK = -FRONT
SIDE = 1.5 * CELL_ACROSS - 0.03
BELT = 0.5
ROOF = 1.2
ROOF_T = 0.07
RAKE_TOP = FRONT - 0.36  # the windshield top
PILLAR = 0.06


def build(kit: Kit) -> None:
    kit.box("doors", (FRONT - BACK, 2 * SIDE, BELT), (0, 0, BELT / 2), "paint")
    under_roof = ROOF - ROOF_T
    glass = [(BACK + 0.04, BELT), (FRONT - 0.02, BELT), (RAKE_TOP, under_roof), (BACK + 0.04, under_roof)]
    prism(kit, "glass", glass, -SIDE + 0.04, SIDE - 0.04, "glass")
    for s, (y0, y1) in (("l", (SIDE - PILLAR, SIDE)), ("r", (-SIDE, -SIDE + PILLAR))):
        prism(kit, f"a_pillar_{s}", [(FRONT - 0.1, BELT), (FRONT, BELT), (RAKE_TOP, under_roof), (RAKE_TOP - 0.1, under_roof)], y0, y1, "paint")
        prism(kit, f"c_pillar_{s}", [(BACK, BELT), (BACK + 0.22, BELT), (BACK + 0.18, under_roof), (BACK, under_roof)], y0, y1, "paint")
    kit.box("back_wall", (0.06, 2 * SIDE, under_roof - BELT), (BACK + 0.03, 0, (BELT + under_roof) / 2), "paint")
    kit.box("rear_window", (0.02, 2 * SIDE - 0.4, 0.34), (BACK - 0.005, 0, BELT + 0.3), "glass")
    prism(kit, "roof", [(BACK, under_roof), (RAKE_TOP + 0.02, under_roof), (RAKE_TOP - 0.02, ROOF), (BACK, ROOF)], -SIDE, SIDE, "trim")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    build(kit)
    check_footprint(kit, "cab_pickup", 3, 2)
    kit.export("cab_pickup", args, view_size=2.0)


if __name__ == "__main__":
    main()
