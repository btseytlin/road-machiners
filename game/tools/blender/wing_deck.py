"""Broken Wing's deck: the crashed ship's wing lying flat on lattice and pylons, with the road on top.

The deck is 156 m long along X and 24 m wide along Y between the rail lines, the sim's broken-wing deck
in TERRAIN.features.decks. The origin is the deck top's center, so the plated top is z = 0 and the dirt
track stands 2 cm proud of it. The bent lip on both long edges stands where the sim's rails are, 1.2 to
1.6 m high. The lattice skirts and the pylons reach 8 m below the top, so they bury into ground higher
than the road dip under the deck.
The Broken Wing site builder stretches it to the sim deck, the way buildBridge stretches bridge.py, so
keep the sizes equal to the data and the stretch near 1.
Run: blender --background --python tools/blender/wing_deck.py -- public/models/wing_deck.glb [tmp/wing_deck.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import loft, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "road": 0xA8865A,  # packed dirt, the PAL.road of before issue 129
    "road_rut": 0x937450,  # ruts a shade darker than the road
}
SEED = 114

LENGTH = 156.0  # the sim deck's 39 tiles
WIDTH = 24.0  # between the rail lines, the sim deck's 6 tiles
HALF = WIDTH / 2
SLAB = 0.6  # plate slab thickness
TRACK = 12.0  # dirt track width, half the deck, as in the concept image
TILE = (3.0, 2.0)  # plate tile along and across, three rows on each plated band
RUST_PATCHES = 7  # per side; they cover about a sixth of the plating, as in the image
BOTTOM = -8.0  # lattice and pylon feet
BEAM = (0.8, 1.4)  # edge beam width and depth
LIP = (1.2, 1.6)  # bent lip height range, over the rail line
BAY = 5.2  # lattice bay length, 30 bays
SKIRT_IN = 1.0  # the lattice stands this far in from the deck edge, under the beam's inner side
PYLONS = 5  # per side, LENGTH / 6 apart
PYLON_WIDTH = 7.0  # about a quarter of the spacing, as in the image
PYLON_FOOT = 4.4  # how far a pylon's foot leans out past its top, about 28 degrees over its 8.25 m


def pylon_xs() -> list[float]:
    spacing = LENGTH / (PYLONS + 1)
    return [-LENGTH / 2 + spacing * (i + 1) for i in range(PYLONS)]


def rust_patches(kit: Kit) -> list[tuple[float, float, float, float]]:
    """Seeded rust patches as ellipses (x, |y|, radius along, radius across) on the plated bands of one side."""
    return [
        (kit.rng.uniform(-LENGTH / 2 + 4, LENGTH / 2 - 4), kit.rng.uniform(TRACK / 2, HALF), kit.rng.uniform(4, 8), kit.rng.uniform(1.5, 3.5))
        for _ in range(RUST_PATCHES)
    ]


def slab(kit: Kit) -> None:
    """The plate slab: tiles of light and dark plating with rust patches, and the dirt track down the middle."""
    kit.box("slab", (LENGTH, WIDTH - 0.2, SLAB - 0.1), (0, 0, -SLAB / 2 - 0.05), "metal")
    tiles_along = int(LENGTH / TILE[0])
    rows = int((HALF - TRACK / 2) / TILE[1])
    for side in (-1, 1):
        patches = rust_patches(kit)
        for i in range(tiles_along):
            x = -LENGTH / 2 + TILE[0] * (i + 0.5)
            for r in range(rows):
                y = TRACK / 2 + TILE[1] * (r + 0.5)
                if any(((x - px) / ax) ** 2 + ((y - py) / ay) ** 2 < 1 for px, py, ax, ay in patches):
                    mat = "rust" if kit.rng.random() < 0.6 else "rust_side"
                else:
                    mat = "metal" if kit.rng.random() < 0.08 else "metal_light"
                kit.box(f"tile_{side}_{i}_{r}", (TILE[0] - 0.12, TILE[1] - 0.12, 0.12), (x, side * y, -0.06), mat, dent_by=0.025)
    kit.box("track", (LENGTH, TRACK, 0.04), (0, 0, 0.0), "road")
    # Two worn wheel ruts, a shade darker than the track, and a few rust stains spilling onto it.
    for side in (-1, 1):
        kit.box(f"rut_{side}", (LENGTH, 0.9, 0.02), (0, side * 2.4, 0.025), "road_rut")
    for i in range(5):
        x = kit.rng.uniform(-LENGTH / 2 + 8, LENGTH / 2 - 8)
        y = kit.rng.choice((-1, 1)) * (TRACK / 2 - kit.rng.uniform(0.3, 1.2))
        kit.box(f"stain{i}", (kit.rng.uniform(2, 5), kit.rng.uniform(1, 2), 0.02), (x, y, 0.025), "road_rut", rot=(0, 0, kit.rng.uniform(-0.3, 0.3)))
    # Cross girders under the slab at the pylons, tying the two skirts (inferred, hidden by the lattice).
    for x in pylon_xs():
        kit.box(f"girder_{x:.0f}", (0.8, WIDTH - 2 * SKIRT_IN, 0.9), (x, 0, -SLAB - 0.45), "rust_dark")


def edges(kit: Kit) -> None:
    """On both sides: the box edge beam with dark holes, and a bent lip over the rail line, torn in places."""
    for side in (-1, 1):
        y = side * HALF
        kit.box(f"beam_{side}", (LENGTH, BEAM[0], BEAM[1]), (0, y, -BEAM[1] / 2), "rust_side", dent_by=0.03)
        outer = y + side * (BEAM[0] / 2 + 0.02)
        for i in range(int(LENGTH / 3)):
            x = -LENGTH / 2 + 3 * (i + 0.5)
            kit.box(f"hole_{side}_{i}", (0.6, 0.06, 0.45), (x, outer, -BEAM[1] / 2), "rust_dark")
        # Lip segments: some stand, some are torn off, so the edge reads ragged as in the image.
        seg = 6.0
        for i in range(int(LENGTH / seg)):
            if kit.rng.random() < 0.22:
                continue
            x = -LENGTH / 2 + seg * (i + 0.5)
            h = kit.rng.uniform(*LIP)
            lean = kit.rng.uniform(0.15, 0.45)  # bent outward
            length = seg - kit.rng.uniform(0.3, 1.5)
            mat = kit.rng.choice(("metal_light", "metal_light", "metal", "rust"))
            kit.box(
                f"lip_{side}_{i}",
                (length, 0.12, h),
                (x, y + side * math.sin(lean) * h / 2, math.cos(lean) * h / 2),
                mat,
                rot=(side * lean, 0, kit.rng.uniform(-0.03, 0.03)),
                dent_by=0.06,
            )


def skirts(kit: Kit) -> None:
    """X-braced lattice from under the beam down to the feet, on both sides."""
    top = -BEAM[1]
    bays = int(round((LENGTH - 2) / BAY))
    span = bays * BAY
    for side in (-1, 1):
        y = side * (HALF - SKIRT_IN)
        mid = (top + BOTTOM) / 2
        for z, name in ((top, "top"), (mid, "mid"), (BOTTOM + 0.3, "low")):
            kit.box(f"chord_{name}_{side}", (span, 0.3, 0.3), (0, y, z), "rust_dark")
        for i in range(bays + 1):
            x = -span / 2 + BAY * i
            strut(kit, f"post_{side}_{i}", (x, y, BOTTOM), (x, y, top), 0.5, "rust_dark")
        for i in range(bays):
            x0 = -span / 2 + BAY * i
            for z0, z1 in ((top, mid), (mid, BOTTOM)):
                strut(kit, f"x_{side}_{i}_{z0:.0f}a", (x0, y, z0), (x0 + BAY, y, z1), 0.32, "rust_dark")
                strut(kit, f"x_{side}_{i}_{z0:.0f}b", (x0, y, z1), (x0 + BAY, y, z0), 0.32, "rust_dark")


def pylons(kit: Kit) -> None:
    """Five plated slabs per side, each leaning out from the edge beam to the feet like a buttress.

    The slab is a wedge in section: 1.8 m thick at the beam and thicker at the foot, so its top face is the
    broad pale plate the image shows and its end is a narrow strip.
    """
    inner = HALF - 0.3
    top = 0.25
    thick = 1.8
    slope = PYLON_FOOT / (top - BOTTOM)
    ring = [(inner, top), (inner + thick, top), (inner + thick + PYLON_FOOT, BOTTOM), (inner + PYLON_FOOT * 0.45, BOTTOM)]
    w = PYLON_WIDTH / 2
    for side in (-1, 1):
        for i, x in enumerate(pylon_xs()):
            loft(kit, f"pylon_{side}_{i}", [[(x + dx, side * yy, z) for yy, z in ring] for dx in (-w, w)], "metal_light")
            # Plate seams across the slanted face, and a dark cap where it meets the beam.
            for k in (1, 2):
                z = top + (BOTTOM - top) * k / 3
                yy = inner + thick + PYLON_FOOT * k / 3 + 0.05
                kit.box(f"seam_{side}_{i}_{k}", (PYLON_WIDTH + 0.1, 0.1, 0.3), (x, side * yy, z), "metal", rot=(side * math.atan(slope), 0, 0))
            kit.box(f"cap_{side}_{i}", (PYLON_WIDTH + 0.3, thick + 0.3, 0.3), (x, side * (inner + thick / 2), top + 0.1), "metal")


def ends(kit: Kit) -> None:
    """Crumpled plates where the slab meets the ramps: bent down and out past each end, off the track's middle."""
    for end in (-1, 1):
        x_end = end * LENGTH / 2
        # The slab ends in a torn rust edge.
        kit.box(f"torn_{end}", (0.5, WIDTH, SLAB + 0.2), (x_end, 0, -SLAB / 2), "rust_side", dent_by=0.15)
        for i in range(9):
            y = kit.rng.choice((-1, 1)) * kit.rng.uniform(3.5, HALF + 1.5)
            reach = kit.rng.uniform(1.0, 5.0)
            size = (kit.rng.uniform(2.5, 4.5), kit.rng.uniform(1.5, 3.0), 0.12)
            drop = kit.rng.uniform(0.15, 0.45)  # bent down toward the ramp
            mat = kit.rng.choice(("metal_light", "metal", "rust", "rust_side"))
            kit.box(
                f"crumple_{end}_{i}",
                size,
                (x_end + end * reach, y, -math.sin(drop) * reach * 0.5 - 0.1),
                mat,
                rot=(kit.rng.uniform(-0.25, 0.25), end * drop, kit.rng.uniform(-0.5, 0.5)),
                dent_by=0.2,
            )


def build(kit: Kit) -> None:
    slab(kit)
    edges(kit)
    skirts(kit)
    pylons(kit)
    ends(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("wing_deck", args, view_size=170)


if __name__ == "__main__":
    main()
