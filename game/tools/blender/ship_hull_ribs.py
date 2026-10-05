"""The colony ship's skeletal hull section (C5): most of its plating is gone, showing a rust-brown lattice of ring
ribs, stringers and X-braces over a dark deck, with a few plates left on the far side and a few loose plates hanging.

Built at its in-game size on the shared hull profile (ship_hull_kit.py): 45 m long and 36 m across. The origin is the
hull axis at its rear joint, and it runs +X to its front joint at X = 45. The plate row at the front joint stays
whole, so it meets the closed ring section. Raised frames stand at the rear joint and halfway along.
Run: blender --background --python tools/blender/ship_hull_ribs.py -- public/models/ship_hull_ribs.glb [tmp/ship_hull_ribs.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from ship_hull_kit import COLORS, FRAME, PLATE, SIDES, brace, deck, frame, hanging_plate, plating, rib, stations, stringer  # noqa: E402

SEED = 25
LENGTH = 45.0
OPEN_FACES = range(10, 16)  # faces 10, 11 and 0 to 3: the top and the camera side
KEPT_SHARE = 0.12  # plates left on the open faces
FAR_SHARE = 0.7  # plates left on the far side, away from the camera
BRACE_SHARE = 0.9
HANGING = ((10.0, 11, 0.3), (22.0, 10, 0.4), (33.0, 11, 0.3), (16.0, 0, 0.3))  # x, face, droop


def build(kit: Kit) -> None:
    rings = stations(0.0, LENGTH)
    last = len(rings) - 2
    gone: set[tuple[int, int]] = set()
    open_faces = {k % SIDES for k in OPEN_FACES}

    def keep(i: int, k: int) -> bool:
        if i == last:
            return True
        if k in open_faces:
            kept = kit.rng.random() < KEPT_SHARE
        elif k in (4, 5, 6):
            kept = kit.rng.random() < FAR_SHARE
        else:
            return True
        if not kept:
            gone.add((i, k))
        return kept

    plating(kit, "plate", rings, keep, lined=True)
    deck(kit, "deck", 0.2, LENGTH - 0.2)
    for j, (x, _, _) in enumerate(rings[:-1]):
        rib(kit, f"rib{j}", x + 0.4, range(SIDES), size=1.0)
        rib(kit, f"rib{j}b", x + PLATE / 2, range(SIDES), size=0.6)
    for k in range(SIDES):
        stringer(kit, f"stringer{k}", 0.0, LENGTH - PLATE, k, size=0.8)
    for i, k in sorted(gone):
        if kit.rng.random() < BRACE_SHARE:
            brace(kit, f"brace_{i}_{k}", rings[i][0] + 0.5, rings[i + 1][0] - 0.5, k, size=0.5)
    frame(kit, "frame_rear", FRAME / 2)
    frame(kit, "frame_mid", LENGTH / 2)
    for n, (x, k, droop) in enumerate(HANGING):
        hanging_plate(kit, f"hanging{n}", x, k, droop, "pale" if n % 2 else "bone")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_hull_ribs", args, view_size=90)


if __name__ == "__main__":
    main()
