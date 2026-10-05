"""A low hardtop cabin on its own, drawn only for the cabHardtop icon. The truck view draws it from the convertible's base.

Footprint is 3x2 cells, 1.45 m across by 1.3 m along. Painted doors to the 0.42 m beltline, a strongly raked
windshield, a flat trim roof at 0.95 m, pillarless side glass and a sloped rear window between wide C pillars, like the
convertible's hardtop. The windshield faces +X.
Run: blender --background --python tools/blender/cab_hardtop.py -- public/models/cab_hardtop.glb [tmp/cab_hardtop.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import CELL_ACROSS, CELL_ALONG, Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS  # noqa: E402
from parts_common_core import check_footprint  # noqa: E402
from shapes import prism  # noqa: E402

SEED = 641
FRONT = CELL_ALONG - 0.02  # 2 cells along, so the half length is one cell
BACK = -FRONT
SIDE = 1.5 * CELL_ACROSS - 0.03
BELT = 0.42
ROOF = 0.95
ROOF_T = 0.06
SCREEN_TOP = FRONT - 0.5  # where the windshield meets the roof
ROOF_BACK = BACK + 0.36  # where the rear window meets the roof
C_PILLAR = 0.2


def build(kit: Kit) -> None:
    kit.box("doors", (FRONT - BACK, 2 * SIDE, BELT), (0, 0, BELT / 2), "paint")
    under_roof = ROOF - ROOF_T
    glass = [(BACK + 0.02, BELT), (FRONT - 0.02, BELT), (SCREEN_TOP, under_roof), (ROOF_BACK, under_roof)]
    prism(kit, "glass", glass, -SIDE + 0.03, SIDE - 0.03, "glass")
    c_pillar = [(BACK, BELT), (BACK + C_PILLAR, BELT), (ROOF_BACK + C_PILLAR * 0.6, under_roof), (ROOF_BACK, under_roof)]
    for s, (y0, y1) in (("l", (SIDE - 0.08, SIDE)), ("r", (-SIDE, -SIDE + 0.08))):
        prism(kit, f"c_pillar_{s}", c_pillar, y0, y1, "paint")
    prism(kit, "roof", [(ROOF_BACK, under_roof), (SCREEN_TOP + 0.02, under_roof), (SCREEN_TOP - 0.04, ROOF), (ROOF_BACK, ROOF)], -SIDE, SIDE, "trim")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    build(kit)
    check_footprint(kit, "cab_hardtop", 3, 2)
    kit.export("cab_hardtop", args, view_size=2.0)


if __name__ == "__main__":
    main()
