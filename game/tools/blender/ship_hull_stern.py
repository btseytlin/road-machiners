"""The colony ship's broken rear (C5): the last hull section, torn open. Its plates end at uneven lengths, shorter on
top, the ribs run on past them and break off, and bent plates hang and stick out at the tear. A dark deck and liner
show inside.

Built at its in-game size on the shared hull profile (ship_hull_kit.py): up to 36 m long and 36 m across. The origin is
the hull axis at its front joint, where it meets ship_hull_ribs, and it runs -X to the torn end at X = -36.
Run: blender --background --python tools/blender/ship_hull_stern.py -- public/models/ship_hull_stern.glb [tmp/ship_hull_stern.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from ship_hull_kit import AXIS_Z, COLORS, RADIUS, SIDES, deck, face_angle, hanging_plate, plating, rib, stations, stringer  # noqa: E402
from shapes import strut  # noqa: E402

SEED = 26
LENGTH = 36.0
# A face's plating ends this far back: long on the underside, short on top, give or take TEAR_JITTER.
TEAR = (30.0, 9.0)  # meters at the bottom and at the top
TEAR_JITTER = 5.0
RIB_PAST = 8.0  # ribs run this far past their face's last plate
RIB_SHARE = 0.8
BENT_SHARE = 0.5


def build(kit: Kit) -> None:
    rings = stations(0.0, -LENGTH)
    tear = []
    for k in range(SIDES):
        up = max(0.0, math.sin(face_angle(k)))
        tear.append(min(LENGTH, max(9.0, TEAR[0] + (TEAR[1] - TEAR[0]) * up + kit.rng.uniform(-TEAR_JITTER, TEAR_JITTER))))

    def keep(i: int, k: int) -> bool:
        return -rings[i + 1][0] <= tear[k]

    plating(kit, "plate", rings, keep, lined=True)
    deck(kit, "deck", -0.2, -LENGTH + 6.0)
    for j, (x, _, _) in enumerate(rings[1:]):
        faces = [k for k in range(SIDES) if -x <= tear[k] + RIB_PAST and kit.rng.random() < RIB_SHARE]
        rib(kit, f"rib{j}", x + 0.4, faces, size=1.0)
    for k in range(SIDES):
        stringer(kit, f"stringer{k}", 0.0, -min(LENGTH, tear[k] + RIB_PAST * 0.5), k, size=0.8)
    for k in range(SIDES):
        if kit.rng.random() < BENT_SHARE:
            x = -min(LENGTH - 3.0, tear[k] + 2.0)
            hanging_plate(kit, f"bent{k}", x, k, kit.rng.uniform(-0.7, 0.9), kit.rng.choice(("pale", "bone", "grey", "rust")))
    # Broken ribs sticking out of the torn end.
    for n in range(8):
        k = kit.rng.randrange(0, SIDES)
        a = face_angle(k)
        x0 = -min(LENGTH, tear[k] + 2.0)
        base = (x0, (RADIUS - 0.4) * math.cos(a), AXIS_Z + (RADIUS - 0.4) * math.sin(a))
        tip = (x0 - kit.rng.uniform(3, 7), base[1] * kit.rng.uniform(0.75, 1.1), base[2] + kit.rng.uniform(-3, 5))
        strut(kit, f"broken{n}", base, tip, 0.8, "frame")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_hull_stern", args, view_size=90)


if __name__ == "__main__":
    main()
