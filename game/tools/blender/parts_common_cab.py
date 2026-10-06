"""The closed cab drawn for the cab icons, in one shape that each cab script sizes.

The truck view draws cabs from the base models, so these models stand in only for the icons. A cab is 2 cells along and
cells across wide: painted doors to the 0.5 m beltline, a dark glass band, a rear window, a raked windshield facing +X
and a trim roof. Its origin is the footprint center on the deck top, at Z = 0.
"""

from __future__ import annotations

from kit import CELL_ACROSS, CELL_ALONG, Kit
from parts_common_base import BASE_COLORS
from parts_common_core import check_footprint
from shapes import prism

COLORS = BASE_COLORS
FRONT = CELL_ALONG - 0.02  # 2 cells along, so the half length is one cell
BACK = -FRONT
BELT = 0.5
ROOF_T = 0.07
PILLAR = 0.06


def build_cab(kit: Kit, name: str, cells_across: int, roof: float, rake: float) -> None:
    """A closed cab cells_across wide with its roof top at roof. rake is how far the windshield top sits behind the nose."""
    side = cells_across * CELL_ACROSS / 2 - 0.03
    rake_top = FRONT - rake
    under_roof = roof - ROOF_T
    kit.box("doors", (FRONT - BACK, 2 * side, BELT), (0, 0, BELT / 2), "paint")
    glass = [(BACK + 0.04, BELT), (FRONT - 0.02, BELT), (rake_top, under_roof), (BACK + 0.04, under_roof)]
    prism(kit, "glass", glass, -side + 0.04, side - 0.04, "glass")
    for s, (y0, y1) in (("l", (side - PILLAR, side)), ("r", (-side, -side + PILLAR))):
        prism(kit, f"a_pillar_{s}", [(FRONT - 0.1, BELT), (FRONT, BELT), (rake_top, under_roof), (rake_top - 0.1, under_roof)], y0, y1, "paint")
        prism(kit, f"c_pillar_{s}", [(BACK, BELT), (BACK + 0.22, BELT), (BACK + 0.18, under_roof), (BACK, under_roof)], y0, y1, "paint")
    kit.box("back_wall", (0.06, 2 * side, under_roof - BELT), (BACK + 0.03, 0, (BELT + under_roof) / 2), "paint")
    window = (under_roof - BELT) * 0.6
    kit.box("rear_window", (0.02, 2 * side * 0.6, window), (BACK - 0.005, 0, (BELT + under_roof) / 2), "glass")
    prism(kit, "roof", [(BACK, under_roof), (rake_top + 0.02, under_roof), (rake_top - 0.02, roof), (BACK, roof)], -side, side, "trim")
    check_footprint(kit, name, cells_across, 2)
