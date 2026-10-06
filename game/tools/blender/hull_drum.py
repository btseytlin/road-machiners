"""Fallen Sun hull drum: a closed, ring-banded drum section of the crashed colony ship, sunk in the sand.

Reference radius 20 m. The drum is 40 m long along X: five fourteen-sided hull rings of radius 10 m, alternately a
step narrower, round an axis 3 m above the ground, so it lies 19 m wide and 13 m tall. Six raised ring bands
cover the joints and ends. The +X end cap is dented in, the -X cap is torn open onto a dark interior, and rust
patches and streaks run down the plates.
Run: blender --background --python tools/blender/hull_drum.py -- public/models/hull_drum.glb [tmp/hull_drum.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

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
SEED = 85

R = 10.0
CZ = 3.0
HALF = 20.0
SIDES = 14
RINGS = 5
ALONG = (0, math.radians(90), 0)  # turns a Z-axis cylinder to lie along X


def body(kit: Kit) -> None:
    length = 2 * HALF / RINGS
    for i in range(RINGS):
        x = -HALF + length * (i + 0.5)
        r = R if i % 2 == 0 else R - 0.4
        mat = "hull" if i != 2 else "hull_grey"
        kit.cylinder(f"ring_{i}", r, length, (x, 0, CZ), mat, rot=ALONG, vertices=SIDES, dent_by=0.08)
    # Raised bands on every joint and both ends; the middle one is a rusted frame.
    for i in range(RINGS + 1):
        x = -HALF + length * i
        x = max(-HALF + 0.6, min(HALF - 0.6, x))
        mat = "rust_side" if i == 2 else "hull_grey"
        kit.cylinder(f"band_{i}", R + 0.45, 1.2 if i in (0, RINGS) else 1.0, (x, 0, CZ), mat, rot=ALONG, vertices=SIDES, dent_by=0.06)


def caps(kit: Kit) -> None:
    # The +X cap bulges a little and is dented in on one side.
    cap = kit.cylinder("cap_fore", R - 0.3, 1.6, (HALF + 0.6, 0, CZ), "hull_grey", rot=ALONG, vertices=SIDES, dent_by=0.3)
    taper(cap, 0.75)
    kit.box("cap_dent", (0.3, 4.0, 3.0), (HALF + 1.2, -2.5, CZ + 4.0), "rust", rot=(math.radians(25), math.radians(-60), 0), dent_by=0.2)
    # The -X cap is torn open: a dark interior set back inside, with torn plates bent round the hole.
    kit.cylinder("hole", R - 1.2, 0.4, (-HALF + 1.6, 0, CZ), "soot", rot=ALONG, vertices=SIDES)
    for k in range(6):
        a = k * math.tau / 6 + kit.rng.uniform(-0.2, 0.2)
        y, z = math.cos(a) * (R - 2.2), CZ + math.sin(a) * (R - 2.2)
        if z < 0.5:
            continue
        kit.box(f"torn_{k}", (0.3, kit.rng.uniform(3.0, 5.0), kit.rng.uniform(2.0, 3.5)), (-HALF - 0.4, y, z), "hull_dark", rot=(a, math.radians(kit.rng.uniform(-35, 35)), 0), dent_by=0.2)


def rust(kit: Kit) -> None:
    # Rust patches and streaks laid flat on the ring facets.
    face_r = R * math.cos(math.pi / SIDES)
    length = 2 * HALF / RINGS
    for i in range(18):
        ring = kit.rng.randrange(RINGS)
        r = (face_r if ring % 2 == 0 else (R - 0.4) * math.cos(math.pi / SIDES)) + 0.05
        k = kit.rng.choice([j for j in range(SIDES) if math.sin((j + 0.5) * math.tau / SIDES) > -0.2])
        a = (k + 0.5) * math.tau / SIDES
        y, z = math.cos(a) * r, CZ + math.sin(a) * r
        streak = i % 2 == 0
        w = kit.rng.uniform(0.6, 1.2) if streak else kit.rng.uniform(1.5, 4.5)
        h = kit.rng.uniform(2.5, 4.2) if streak else kit.rng.uniform(1.2, 2.6)
        x = -HALF + length * ring + kit.rng.uniform(1.0 + w / 2, length - 1.0 - w / 2)
        mat = kit.rng.choice(["rust", "rust", "rust_side", "rust_dark"])
        patch = kit.box(f"rust_{i}", (w, h, 0.05), (x, y, z), mat, dent_by=0.02)
        # Spin the patch about its own normal first, then lay it on facet k.
        patch.rotation_mode = "ZXY"
        patch.rotation_euler = (a - math.pi / 2, 0, math.radians(kit.rng.uniform(-25, 25)))


def build(kit: Kit) -> None:
    body(kit)
    caps(kit)
    rust(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("hull_drum", args, view_size=55.0)


if __name__ == "__main__":
    main()
