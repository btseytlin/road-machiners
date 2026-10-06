"""Fallen Sun wing deck: one plate of the ship's torn wing, lying in the crash furrow as a drivable deck.

Reference size: 88 m long along X (the level span's 22 tiles), 32 m wide along Y between the rail lines (the sim's
8 tile wing decks), and the top at z = 0. The origin is the deck top's center, as in wing_deck.py, so the wing deck
view poses it on each wing deck the way poseOnDeck poses Broken Wing's, stretched to that deck's length and width.
The up-ramp and down-ramp are about 8 tiles, so they squeeze it along X to about 0.36. The span is
inferred: neither reference image shows the wing.
- The top is hull plating in panels with dark seams, rust patches and rust streaks running across the chord. Nothing
  stands more than 2 cm proud of z = 0, so trucks drive on it as drawn.
- The leading edge (+Y) is a rounded hull beam. The trailing edge (-Y) is torn: ragged plate ends, plates bent down
  over the edge and spar stubs sticking out, all within 1.5 m past the rail line.
- A torn skirt plate hangs 1.6 to 3.8 m under each side. The view draws the skirt on down to the ground along each
  rail, mirroring the physics skirt. Both ends are clean, so segments join end to end.
Run: blender --background --python tools/blender/ship_wing_deck.py -- public/models/ship_wing_deck.glb [tmp/ship_wing_deck.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
}
SEED = 81

LENGTH = 88.0  # the level span's 22 tiles
WIDTH = 32.0  # between the rail lines, the wing decks' 8 tiles
HALF = WIDTH / 2
SLAB = 0.8  # plate slab thickness
PANEL = (4.0, 3.2)  # panel along and across: 22 along, 10 rows across
SEAM = 0.14  # the gap between panels, where the dark slab shows
SPAR_SEAM = 0.4  # every third row, a wider seam over a spar
RUST_PATCHES = 9
STREAKS = 26  # rust streaks running across the chord from the trailing edge
LEADING = 0.7  # the leading edge beam's radius
TORN_ROW = (0.45, 1.0)  # the trailing edge row keeps this share of its width
SKIRT_DROP = (1.6, 3.8)  # how far each skirt plate hangs under the slab's underside
SKIRT_SEG = (4.0, 7.0)


def rust_patches(kit: Kit) -> list[tuple[float, float, float, float]]:
    """Seeded rust patches as ellipses (x, y, radius along, radius across) on the top."""
    return [
        (kit.rng.uniform(-LENGTH / 2 + 4, LENGTH / 2 - 4), kit.rng.uniform(-HALF + 2, HALF - 2), kit.rng.uniform(3, 7), kit.rng.uniform(1.5, 4))
        for _ in range(RUST_PATCHES)
    ]


def slab(kit: Kit) -> None:
    """The dark slab, with the trailing row cut away, so the torn row's ragged plates make the -Y edge."""
    kit.box("slab", (LENGTH, WIDTH - PANEL[1], SLAB - 0.1), (0, PANEL[1] / 2, -SLAB / 2 - 0.05), "hull_dark")
    # Two spars under the slab, along the span.
    for y in (-HALF / 2, HALF / 2):
        kit.box(f"spar_{y:.0f}", (LENGTH, 0.8, 1.0), (0, y, -SLAB - 0.5), "rust_dark")


def panels(kit: Kit) -> None:
    """Hull panels over the slab. The trailing row (-Y) is full slab depth and torn to ragged widths."""
    along = int(LENGTH / PANEL[0])
    rows = int(WIDTH / PANEL[1])
    patches = rust_patches(kit)
    for r in range(rows):
        y0 = -HALF + PANEL[1] * r
        gap = SPAR_SEAM if r % 3 == 0 else SEAM
        band = "hull" if r % 4 else "hull_grey"  # a darker band every fourth row, so the chord reads
        for i in range(along):
            x = -LENGTH / 2 + PANEL[0] * (i + 0.5)
            yc = y0 + PANEL[1] / 2
            if any(((x - px) / ax) ** 2 + ((yc - py) / ay) ** 2 < 1 for px, py, ax, ay in patches):
                mat = "rust" if kit.rng.random() < 0.7 else "rust_side"
            else:
                roll = kit.rng.random()
                mat = "hull_grey" if roll < 0.12 else "hull_dark" if roll < 0.16 else band
            if r == 0:
                # The torn trailing row: each plate keeps a random share of its width from the inner side.
                keep = kit.rng.uniform(*TORN_ROW) * PANEL[1]
                if kit.rng.random() < 0.15:
                    continue
                y = y0 + PANEL[1] - keep / 2
                kit.box(f"torn_{i}", (PANEL[0] - SEAM, keep, SLAB), (x, y, -SLAB / 2), mat, dent_by=0.06)
                continue
            kit.box(f"panel_{r}_{i}", (PANEL[0] - SEAM, PANEL[1] - gap, 0.12), (x, yc, -0.06), mat, dent_by=0.02)


def streaks(kit: Kit) -> None:
    """Rust streaks running in from the trailing edge across the chord, flush with the top."""
    for i in range(STREAKS):
        x = kit.rng.uniform(-LENGTH / 2 + 1, LENGTH / 2 - 1)
        length = kit.rng.uniform(3, 10)
        width = kit.rng.uniform(0.4, 1.2)
        y = -HALF + PANEL[1] + length / 2 - kit.rng.uniform(0, 1.5)
        mat = "rust" if i % 3 else "rust_side"
        kit.box(f"streak{i}", (width, length, 0.02), (x, y, 0.01), mat, rot=(0, 0, kit.rng.uniform(-0.12, 0.12)))


def leading_edge(kit: Kit) -> None:
    """The rounded leading edge along +Y, its top flush with the deck."""
    kit.cylinder("leading", LEADING, LENGTH, (0, HALF - LEADING * 0.6, -LEADING), "hull_grey", rot=(0, math.radians(90), 0), vertices=6)


def trailing_edge(kit: Kit) -> None:
    """Plates bent down over the torn trailing edge and spar stubs sticking out of it."""
    for i in range(12):
        x = kit.rng.uniform(-LENGTH / 2 + 3, LENGTH / 2 - 3)
        drop = kit.rng.uniform(0.35, 0.9)
        size = (kit.rng.uniform(2.0, 3.6), kit.rng.uniform(1.2, 2.0), 0.14)
        mat = kit.rng.choice(("hull", "hull_grey", "rust"))
        y = -HALF + PANEL[1] * 0.4 - math.cos(drop) * size[1] / 2
        kit.box(f"bent_{i}", size, (x, y, -SLAB - math.sin(drop) * size[1] / 2), mat, rot=(drop, 0, kit.rng.uniform(-0.2, 0.2)), dent_by=0.1)
    for i in range(16):
        x = kit.rng.uniform(-LENGTH / 2 + 2, LENGTH / 2 - 2)
        reach = kit.rng.uniform(0.6, 1.5)
        z = -SLAB * kit.rng.uniform(0.3, 0.7)
        y0 = -HALF + PANEL[1] * 0.4
        strut(kit, f"stub_{i}", (x, y0, z), (x + kit.rng.uniform(-0.8, 0.8), -HALF - reach, z - kit.rng.uniform(0, 0.6)), 0.3, "rust_dark")


def skirts(kit: Kit) -> None:
    """A torn skirt plate hanging under each side: segments of ragged depth, leaning out a little, some torn away."""
    top = -SLAB
    for side in (-1, 1):
        y = side * (HALF - 0.15)
        x = -LENGTH / 2
        i = 0
        while x < LENGTH / 2 - 0.5:
            seg = min(kit.rng.uniform(*SKIRT_SEG), LENGTH / 2 - x)
            i += 1
            if kit.rng.random() < 0.12:
                x += seg
                continue
            drop = kit.rng.uniform(*SKIRT_DROP)
            lean = side * kit.rng.uniform(0.0, 0.12)
            mat = kit.rng.choice(("hull_grey", "hull_grey", "hull_dark", "rust"))
            kit.box(
                f"skirt_{side}_{i}",
                (seg - 0.15, 0.16, drop),
                (x + seg / 2, y + math.sin(lean) * drop / 2, top - math.cos(lean) * drop / 2),
                mat,
                rot=(-lean, kit.rng.uniform(-0.04, 0.04), 0),
                dent_by=0.08,
            )
            x += seg


def ends(kit: Kit) -> None:
    """Clean end caps where segments meet, so the joints read as one wing."""
    for end in (-1, 1):
        kit.box(f"end_{end}", (0.3, WIDTH - PANEL[1], SLAB), (end * (LENGTH / 2 - 0.15), PANEL[1] / 2, -SLAB / 2 - 0.01), "hull_dark")


def build(kit: Kit) -> None:
    slab(kit)
    panels(kit)
    streaks(kit)
    leading_edge(kit)
    trailing_edge(kit)
    skirts(kit)
    ends(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_wing_deck", args, view_size=100)


if __name__ == "__main__":
    main()
