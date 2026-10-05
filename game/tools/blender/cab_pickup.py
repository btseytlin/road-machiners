"""The cabPickup icon: the regular closed cab, 3x2 cells, roof at 1.2 m, like the scout's cab. See parts_common_cab.py.

Run: blender --background --python tools/blender/cab_pickup.py -- public/models/cab_pickup.glb [tmp/cab_pickup.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_cab import COLORS, build_cab  # noqa: E402

SEED = 640


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build_cab(kit, "cab_pickup", cells_across=3, roof=1.2, rake=0.36)
    kit.export("cab_pickup", args, view_size=2.0)


if __name__ == "__main__":
    main()
