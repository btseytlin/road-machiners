"""Fallen Sun gantry: a fallen lattice girder from the crashed colony ship's dock, lying tilted in the sand.

Reference radius 22 m. The girder is 44 m long along X, a box truss 4 m deep and 3.2 m wide: two trusses of top
and bottom chords with zigzag struts, tied across at every node. Its -X end rests on the ground and its +X end is
propped 8 m up on a broken frame of two legs. A few struts are snapped off. The members are thick, so the girder
still reads when the game shrinks it to a 10 m debris girder.
Run: blender --background --python tools/blender/hull_gantry.py -- public/models/hull_gantry.glb [tmp/hull_gantry.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 88

LENGTH = 44.0
DEPTH = 4.0  # chord spacing
WIDTH = 3.2  # truss spacing
PANELS = 11
RISE = 8.0  # height of the +X end's bottom chord
CHORD = 0.8
WEB = 0.5
SNAPPED = {(0, 3), (1, 7), (1, 8)}  # (truss, panel) diagonals torn away
PITCH = math.asin(RISE / LENGTH)
TURN = Matrix.Rotation(-PITCH, 3, "Y")
BASE = Vector((-LENGTH / 2 * math.cos(PITCH), 0.0, CHORD / 2 - 0.2))


def at(x: float, y: float, z: float) -> Vec3:
    """A point in the girder's own frame (x from 0 along its length, z up from the bottom chord) in model space."""
    return tuple(BASE + TURN @ Vector((x, y, z)))


def girder(kit: Kit) -> None:
    step = LENGTH / PANELS
    for t, y in enumerate((-WIDTH / 2, WIDTH / 2)):
        strut(kit, f"chord_low_{t}", at(0, y, 0), at(LENGTH, y, 0), CHORD, "rust_side", dent_by=0.05)
        strut(kit, f"chord_high_{t}", at(0.4, y, DEPTH), at(LENGTH - 0.4, y, DEPTH), CHORD, "rust_side", dent_by=0.05)
        for p in range(PANELS):
            x0, x1 = p * step, (p + 1) * step
            strut(kit, f"post_{t}_{p}", at(x0, y, 0), at(x0, y, DEPTH), WEB, "rust_dark")
            if (t, p) in SNAPPED:
                # A stub left where the strut tore off.
                strut(kit, f"stub_{t}_{p}", at(x0, y, 0), at(x0 + step * 0.3, y, DEPTH * 0.3), WEB, "rust_dark")
                continue
            a, b = (0, DEPTH) if p % 2 == 0 else (DEPTH, 0)
            strut(kit, f"web_{t}_{p}", at(x0, y, a), at(x1, y, b), WEB, "rust_dark")
        strut(kit, f"post_{t}_end", at(LENGTH, y, 0), at(LENGTH, y, DEPTH), WEB, "rust_dark")
    # Ties across the two trusses at every node, top and bottom, with a few gone.
    for p in range(PANELS + 1):
        x = p * LENGTH / PANELS
        for z in (0.0, DEPTH):
            if (p + int(z)) % 5 == 3:
                continue
            strut(kit, f"tie_{p}_{int(z)}", at(x, -WIDTH / 2, z), at(x, WIDTH / 2, z), WEB, "hull_dark")


def frame(kit: Kit) -> None:
    # The broken prop under the +X end: two splayed legs and a brace; one leg is bent.
    top_x = LENGTH - 3.0
    for i, y in enumerate((-WIDTH / 2 - 1.2, WIDTH / 2 + 1.2)):
        head = Vector(at(top_x, y * 0.6, 0)) - Vector((0, 0, CHORD / 2))
        foot = head + Vector((kit.rng.uniform(-1.5, 1.5), y * 0.8, 0))
        foot.z = -0.3
        if i == 0:
            knee = (head + foot) / 2 + Vector((1.2, -0.6, 0))
            strut(kit, "leg_0_low", tuple(foot), tuple(knee), 0.9, "hull_grey", dent_by=0.05)
            strut(kit, "leg_0_high", tuple(knee), tuple(head), 0.9, "hull_grey", dent_by=0.05)
        else:
            strut(kit, "leg_1", tuple(foot), tuple(head), 0.9, "hull_grey", dent_by=0.05)
    strut(kit, "brace", at(top_x, -WIDTH / 2 - 0.8, -4.0), at(top_x, WIDTH / 2 + 0.8, -4.0), 0.6, "hull_dark")
    kit.box("foot_plate", (3.0, 9.0, 0.5), (at(top_x, 0, 0)[0], 0, 0.1), "hull_dark", rot=(0, 0, math.radians(8)), dent_by=0.1)
    # The -X end sits on a crushed pad of plating.
    kit.box("ground_pad", (4.0, 5.5, 0.6), (BASE.x + 1.5, 0.3, 0.1), "rust_dark", rot=(0, 0, math.radians(-6)), dent_by=0.15)


def build(kit: Kit) -> None:
    girder(kit)
    frame(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_gantry", args, view_size=55.0)


if __name__ == "__main__":
    main()
