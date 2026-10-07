"""One welded steel plate for the 'steelPlate' armor.

A front-edge row of 1 cell: 0.484 m across, 0.65 m deep, outer face at +X. One riveted plate stands upright on the
outer edge, 0.9 m tall, on a foot with a short gusset behind it. It is the one-cell cut of arm_plates.py and shares its build.
Run: blender --background --python tools/blender/arm_plate.py -- public/models/arm_plate.glb [tmp/arm_plate.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm_plates import build_row  # noqa: E402
from kit import Kit  # noqa: E402
from parts_common_armor import run  # noqa: E402

N = 1
SEED = 38


def build(kit: Kit) -> None:
    build_row(kit, N)


if __name__ == "__main__":
    run("arm_plate", build, SEED, N)
