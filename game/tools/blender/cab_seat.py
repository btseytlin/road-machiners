"""An open driver's station on its own, drawn only for the cab (Driver seat) icon. The truck view draws it from its base.

Footprint is 1x2 cells, 0.48 m across by 1.3 m along. A floor pan, a dark firewall at the front, a steering wheel on its
column, a leather bucket seat and a roll bar hoop behind it, 1.0 m tall. The firewall faces +X.
Run: blender --background --python tools/blender/cab_seat.py -- public/models/cab_seat.glb [tmp/cab_seat.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import CELL_ACROSS, CELL_ALONG, Kit, parse_args  # noqa: E402
from parts_common_base import BASE_COLORS  # noqa: E402
from parts_common_core import check_footprint  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 642
FRONT = CELL_ALONG - 0.02  # 2 cells along, so the half length is one cell
BACK = -FRONT
SIDE = CELL_ACROSS / 2 - 0.02
BAR_TOP = 1.0
BAR = 0.06  # roll bar tube thickness


def build(kit: Kit) -> None:
    kit.box("floor", (FRONT - BACK, 2 * SIDE, 0.04), (0, 0, 0.02), "under")
    kit.box("firewall", (0.08, 2 * SIDE, 0.5), (FRONT - 0.04, 0, 0.29), "under")
    strut(kit, "column", (FRONT - 0.1, 0, 0.3), (0.22, 0, 0.62), 0.05, "metal_dark", sides=6)
    kit.cylinder("steering", 0.17, 0.04, (0.2, 0, 0.64), "wheel", rot=(0, -1.0, 0), vertices=8)
    kit.box("seat_base", (0.3, 0.3, 0.14), (-0.15, 0, 0.11), "metal")
    kit.box("cushion", (0.42, 2 * SIDE - 0.04, 0.12), (-0.12, 0, 0.24), "leather")
    kit.box("backrest", (0.1, 2 * SIDE - 0.04, 0.5), (-0.36, 0, 0.5), "leather", rot=(0, -0.2, 0))
    x = BACK + 0.1
    for s, y in (("l", SIDE - BAR / 2), ("r", -SIDE + BAR / 2)):
        strut(kit, f"bar_{s}", (x, y, 0.04), (x, y, BAR_TOP), BAR, "metal_light")
    strut(kit, "bar_top", (x, SIDE - BAR / 2, BAR_TOP), (x, -SIDE + BAR / 2, BAR_TOP), BAR, "metal_light")


def main() -> None:
    args = parse_args()
    kit = Kit(BASE_COLORS, SEED)
    build(kit)
    check_footprint(kit, "cab_seat", 1, 2)
    kit.export("cab_seat", args, view_size=1.6)


if __name__ == "__main__":
    main()
