"""The cabHardtop icon: the closed cab made low, 3x2 cells, roof at 0.98 m.
See parts_common_cab.py.

Run: blender --background --python tools/blender/cab_hardtop.py -- public/models/cab_hardtop.glb [tmp/cab_hardtop.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from parts_common_cab import COLORS, build_cab  # noqa: E402

SEED = 641


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build_cab(kit, "cab_hardtop", cells_across=3, roof=0.98, rake=0.36)
    kit.export("cab_hardtop", args, view_size=2.0)


if __name__ == "__main__":
    main()
