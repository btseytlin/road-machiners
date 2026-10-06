"""Steel hedgehog, the army's tank trap on an approach lane.

Three girders cross at their middles, square to each other, and the trap stands on one end of each.
Built to a 1 m reference radius: about 1.5 m across and 1.2 m tall.
Run: blender --background --python tools/blender/tank_trap.py -- public/models/tank_trap.glb [tmp/tank_trap.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "steel": 0x5E3420,  # PAL.rust.side
}
SEED = 61
LENGTH = 1.9  # m, one girder
THICK = 0.14  # m, a girder's square section


def girder_dirs() -> list[tuple[float, float, float]]:
    """The three girder axes, turned so their shared diagonal points straight up and each girder dips one end down."""
    tilt = math.asin(1 / math.sqrt(3))  # each axis leans this far from level
    return [(math.cos(tilt) * math.cos(a), math.cos(tilt) * math.sin(a), math.sin(tilt)) for a in (0.0, 2 * math.pi / 3, 4 * math.pi / 3)]


def build(kit: Kit) -> None:
    centre = LENGTH / 2 / math.sqrt(3) + THICK / 2  # the lower ends rest on the ground
    for k, (dx, dy, dz) in enumerate(girder_dirs()):
        kit.box(f"girder{k}", (LENGTH, THICK, THICK), (0, 0, centre), "steel", rot=(0, -math.asin(dz), math.atan2(dy, dx)), dent_by=0.01)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("tank_trap", args, view_size=3)


if __name__ == "__main__":
    main()
