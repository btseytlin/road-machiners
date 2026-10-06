"""Fallen Sun hull shard: a cluster of torn hull plates standing on end, like tall jagged spikes.

Reference radius 10 m. Three tilted blades 28 m, 20 m and 16 m tall stand within 10 m of the centre, each a
flattened four-sided spike, so it reads as a torn plate rather than a cone, with a base about a third of its height.
Ragged rust stains their feet, and torn chips and rubble lie at their feet.
Run: blender --background --python tools/blender/hull_shard.py -- public/models/hull_shard.glb [tmp/hull_shard.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402
from shapes import strut, taper  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 86

# Blades: foot (x, y), height, foot half-width, lean (degrees) and lean direction (degrees).
BLADES = [
    ((0.0, 0.0), 28.0, 4.8, 6.0, 150.0),
    ((-6.0, 3.5), 20.0, 3.4, 14.0, 200.0),
    ((5.5, -4.0), 16.0, 2.8, 12.0, -30.0),
]
FLAT = 0.7  # blade thickness over its width


def spike(kit: Kit, name: str, start: Vector, end: Vector, width: float, top: float, mat: str) -> None:
    """A flattened four-sided tapered spike from start to end."""
    part = strut(kit, name, tuple(start), tuple(end), width, mat, sides=4)
    for v in part.data.vertices:
        v.co.x *= FLAT
    taper(part, top)
    kit.dent(part, width * 0.02)


def blade(kit: Kit, i: int, foot: tuple[float, float], height: float, half: float, lean: float, heading: float) -> None:
    lean_r, head_r = math.radians(lean), math.radians(heading)
    up = Vector((math.sin(lean_r) * math.cos(head_r), math.sin(lean_r) * math.sin(head_r), math.cos(lean_r)))
    base = Vector((foot[0], foot[1], -1.0))
    tip = base + up * (height + 1.0)
    top = 0.03
    spike(kit, f"blade_{i}", base, tip, half * 2, top, "hull" if i != 1 else "hull_grey")
    # A rust sleeve over the foot, a hair wider than the blade so it shows on every face.
    t = kit.rng.uniform(0.12, 0.22)
    width = half * 2 * 1.08
    foot_rust = strut(kit, f"rust_foot_{i}", tuple(base - up * 0.2), tuple(base + up * (height + 1.0) * t), width, kit.rng.choice(["rust_side", "rust"]), sides=4)
    for v in foot_rust.data.vertices:
        v.co.x *= FLAT
    taper(foot_rust, 1 - t * (1 - top) - 0.01)
    # Push the sleeve's top corners up and down, so its edge reads as a ragged stain, not a band.
    for v in foot_rust.data.vertices:
        if v.co.z > 0:
            v.co.z += kit.rng.uniform(-0.5, 1.0) * height * 0.08
    # A torn chip of plate leaning on the foot.
    a = head_r + math.pi + kit.rng.uniform(-0.6, 0.6)
    kit.box(f"chip_{i}", (half * 0.9, 0.4, half * 1.2), (foot[0] + math.cos(a) * half * 0.9, foot[1] + math.sin(a) * half * 0.9, half * 0.4), "hull_dark", rot=(0, math.radians(-35), a), dent_by=0.15)


def rubble(kit: Kit, at: Vec3, count: int) -> None:
    for k in range(count):
        a = kit.rng.uniform(0, math.tau)
        d = kit.rng.uniform(2.5, 6.0)
        size = (kit.rng.uniform(1.0, 2.5), kit.rng.uniform(0.8, 2.0), kit.rng.uniform(0.5, 1.2))
        loc = (at[0] + math.cos(a) * d, at[1] + math.sin(a) * d, size[2] * 0.3)
        kit.box(f"rubble_{k}", size, loc, kit.rng.choice(["hull_dark", "hull_grey", "rust_dark"]), rot=(kit.rng.uniform(-0.3, 0.3), kit.rng.uniform(-0.3, 0.3), a), dent_by=0.15)


def build(kit: Kit) -> None:
    for i, (foot, height, half, lean, heading) in enumerate(BLADES):
        blade(kit, i, foot, height, half, lean, heading)
    rubble(kit, (0, 0, 0), 7)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_shard", args, view_size=75.0)


if __name__ == "__main__":
    main()
