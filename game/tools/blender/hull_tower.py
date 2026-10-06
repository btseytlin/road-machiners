"""Fallen Sun hull tower: a tall slab of the crashed colony ship's hull, driven upright into the sand and leaning.

Reference radius 6 m. The slab is 13 m wide (Y), 4 m thick (X) and 28 m tall, leaning back 15 degrees away from +X
from a foot sunk 1.5 m into the sand. Its +X face carries panel seams and rust, its back three ribs, and one side a
lattice frame. Torn plates hang off the top and a heap of broken plating lies round the foot.
Run: blender --background --python tools/blender/hull_tower.py -- public/models/hull_tower.glb [tmp/hull_tower.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
}
SEED = 87

WIDTH = 13.0  # Y
THICK = 4.0  # X
HEIGHT = 28.0
LEAN = math.radians(-15)  # leans back, away from +X, so the +X face turns up to the light
FOOT = Vector((0.0, 0.0, -1.5))
TURN = Matrix.Rotation(LEAN, 3, "Y")


def at(x: float, y: float, z: float) -> Vec3:
    """A point in the slab's own frame (z up its height from the foot) in model space."""
    return tuple(FOOT + TURN @ Vector((x, y, z)))


def slab_box(kit: Kit, name: str, size: Vec3, loc: Vec3, mat: str, dent_by: float = 0.0) -> None:
    kit.box(name, size, at(*loc), mat, rot=(0, LEAN, 0), dent_by=dent_by)


def slab(kit: Kit) -> None:
    hx, hy = THICK / 2, WIDTH / 2
    slab_box(kit, "slab", (THICK, WIDTH, HEIGHT), (0, 0, HEIGHT / 2), "hull", dent_by=0.12)
    # Panel seams on the +X face: two across and one up the middle.
    for i, z in enumerate((10.5, 19.5)):
        slab_box(kit, f"seam_{i}", (0.12, WIDTH + 0.1, 0.35), (hx + 0.04, 0, z), "hull_dark")
    slab_box(kit, "seam_up", (0.12, 0.35, HEIGHT - 1.0), (hx + 0.04, 0.8, HEIGHT / 2), "hull_dark")
    # Rust patches and streaks on the +X face and the -Y side.
    for i in range(5):
        w, h = kit.rng.uniform(0.8, 3.0), kit.rng.uniform(1.5, 5.0)
        y, z = kit.rng.uniform(-hy + w / 2, hy - w / 2), kit.rng.uniform(h / 2 + 1.5, HEIGHT - h / 2 - 1)
        slab_box(kit, f"rust_face_{i}", (0.06, w, h), (hx + 0.07, y, z), kit.rng.choice(["rust", "rust", "rust", "rust_side"]))
    for i in range(3):
        w, h = kit.rng.uniform(1.0, 2.5), kit.rng.uniform(3.0, 8.0)
        x, z = kit.rng.uniform(-hx + w / 2, hx - w / 2), kit.rng.uniform(h / 2 + 1, HEIGHT - h / 2 - 1)
        slab_box(kit, f"rust_side_{i}", (w, 0.06, h), (x, -hy - 0.04, z), kit.rng.choice(["rust", "rust_dark"]))
    # Three ribs up the back.
    for i, y in enumerate((-4.5, 0.0, 4.5)):
        slab_box(kit, f"rib_{i}", (0.9, 0.9, HEIGHT - 2 + kit.rng.uniform(-3, 1)), (-hx - 0.45, y, HEIGHT / 2 - 1), "hull_dark", dent_by=0.08)
    # A lattice frame up the +Y side: two rails and zigzag struts.
    rails = (-hx + 0.4, hx - 0.4)
    for i, x in enumerate(rails):
        slab_box(kit, f"rail_{i}", (0.45, 0.45, HEIGHT - 4), (x, hy + 1.0, HEIGHT / 2 - 2), "rust_dark")
    steps = 9
    for k in range(steps):
        z0, z1 = 1.0 + k * (HEIGHT - 6) / steps, 1.0 + (k + 1) * (HEIGHT - 6) / steps
        a, b = (rails[0], rails[1]) if k % 2 == 0 else (rails[1], rails[0])
        strut(kit, f"lattice_{k}", at(a, hy + 1.0, z0), at(b, hy + 1.0, z1), 0.3, "rust_dark")


def torn_top(kit: Kit) -> None:
    # The top edge is torn: a bent flap and a jagged stub.
    slab_box(kit, "top_stub", (THICK * 0.8, 4.0, 2.5), (0, -3.5, HEIGHT + 1.0), "hull_grey", dent_by=0.3)
    kit.box("top_flap", (0.4, 6.0, 4.0), at(THICK / 2 + 1.0, 3.0, HEIGHT - 0.5), "hull_grey", rot=(0, LEAN + math.radians(40), math.radians(10)), dent_by=0.25)


def rubble(kit: Kit) -> None:
    # Broken plating heaped round the foot, and one big plate fallen against it.
    kit.box("fallen_plate", (6.0, 9.0, 0.8), (5.0, 0.5, 2.0), "hull_grey", rot=(math.radians(8), math.radians(-28), math.radians(6)), dent_by=0.3)
    kit.box("fallen_rust", (3.0, 4.0, 0.12), (5.2, 2.0, 2.6), "rust", rot=(math.radians(8), math.radians(-28), math.radians(6)))
    for k in range(9):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(6.0, 10.0)
        size = (kit.rng.uniform(1.0, 3.0), kit.rng.uniform(1.0, 3.0), kit.rng.uniform(0.4, 1.4))
        loc = (math.cos(a) * d, math.sin(a) * d, size[2] * 0.3)
        kit.box(f"rubble_{k}", size, loc, kit.rng.choice(["hull_dark", "hull_grey", "rust_dark", "rust_side"]), rot=(kit.rng.uniform(-0.4, 0.4), kit.rng.uniform(-0.4, 0.4), a), dent_by=0.15)


def build(kit: Kit) -> None:
    slab(kit)
    torn_top(kit)
    rubble(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_tower", args, view_size=75.0)


if __name__ == "__main__":
    main()
