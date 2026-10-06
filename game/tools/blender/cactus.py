"""Short columnar cactus: a cluster of ribbed columns from one base, as in docs/concepts/wasteland-reference-issue-129.jpg.
Decoration without collision.

Sized at 1 m tall at scale 1, with a footprint radius of about 0.2 m. The game scales it uniformly to at most
1.8 m, under truck clearance, turns it at random and tints it.
Run: blender --background --python tools/blender/cactus.py -- public/models/cactus.glb [tmp/cactus.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

COLORS = {
    "body": 0x70764A,  # PAL.cactus.body
    "shade": 0x585E3A,  # PAL.cactus.shade
}
SEED = 31
RADIUS = 0.06  # m, column radius, about an eighth of the cluster's height as in the reference
RIBS = 7  # column sides, each face reads as a rib
CAP = 0.06  # m, height of the rounded column top
COLUMNS = (  # (angle around the center, distance out, height, lean out in degrees, material)
    (0.0, 0.0, 1.0, 0.0, "body"),
    (0.2, 0.08, 0.75, 7.0, "body"),
    (1.6, 0.08, 0.62, 6.0, "shade"),
    (3.1, 0.08, 0.7, 8.0, "shade"),
    (4.6, 0.08, 0.55, 7.0, "body"),
)


def build(kit: Kit) -> None:
    for i, (a, out, h, lean_deg, mat) in enumerate(COLUMNS):
        lean = math.radians(lean_deg)
        # Tilt the column about the horizontal axis across its direction out, so the top leans away from the center.
        rot = (-math.sin(a) * lean, math.cos(a) * lean, 0.0)
        body = h - CAP
        at = (math.cos(a) * out + math.cos(a) * math.sin(lean) * body / 2, math.sin(a) * out + math.sin(a) * math.sin(lean) * body / 2, body / 2)
        column = kit.cylinder(f"column{i}", RADIUS, body, at, mat, rot=rot, vertices=RIBS)
        taper(column, 0.9)
        top = (math.cos(a) * out + math.cos(a) * math.sin(lean) * (body + CAP / 2), math.sin(a) * out + math.sin(a) * math.sin(lean) * (body + CAP / 2), body + CAP / 2)
        cap = kit.cylinder(f"cap{i}", RADIUS * 0.9, CAP, top, mat, rot=rot, vertices=RIBS)
        taper(cap, 0.45)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("cactus", args, view_size=1.6)


if __name__ == "__main__":
    main()
