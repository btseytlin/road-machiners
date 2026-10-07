"""Riser post that lifts a weapon mount standing below a base's top, so the turret clears the cab when it turns.

Authored 1 m tall on a 0.5 m along by 0.4 m across foot. The view stretches its height from the surface under the column
to the mount and stands the weapon mount on its top. The footprint stays unstretched.
Run: blender --background --python tools/blender/wmount_riser.py -- public/models/wmount_riser.glb [tmp/wmount_riser.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit  # noqa: E402
from parts_common_weapon import run  # noqa: E402

SEED = 63
HEIGHT = 1.0
COLUMN = 0.18  # square column side, chunky enough to read at the default zoom


def build(kit: Kit) -> None:
    kit.box("foot", (0.5, 0.4, 0.05), (0, 0, 0.025), "dark")
    kit.box("column", (COLUMN, COLUMN, HEIGHT - 0.1), (0, 0, HEIGHT / 2), "metal")
    for i, y in enumerate((COLUMN / 2 + 0.03, -COLUMN / 2 - 0.03)):
        kit.box(f"gusset{i}", (0.3, 0.04, 0.35), (0, y, 0.22), "rust_side")
    kit.box("band", (COLUMN + 0.02, COLUMN + 0.02, 0.12), (0, 0, HEIGHT * 0.7), "paint")
    kit.box("top", (0.36, 0.3, 0.05), (0, 0, HEIGHT - 0.025), "dark")
    kit.socket("top", (0, 0, HEIGHT))
    # A corner of the column on the foot: the view stands the post on the highest surface under the column.
    kit.socket("column", (COLUMN / 2, COLUMN / 2, 0))


if __name__ == "__main__":
    run("wmount_riser", build, SEED, preview_m=1.4)
