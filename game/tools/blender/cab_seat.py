"""The cab (Driver seat) icon: the closed cab made narrow for one seat, 1x2 cells, roof at 1.2 m. See parts_common_cab.py.

Run: blender --background --python tools/blender/cab_seat.py -- public/models/cab_seat.glb [tmp/cab_seat.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_cab import COLORS, build_cab  # noqa: E402

SEED = 642


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build_cab(kit, "cab_seat", cells_across=1, roof=1.2, rake=0.36)
    kit.export("cab_seat", args, view_size=1.6)


if __name__ == "__main__":
    main()
