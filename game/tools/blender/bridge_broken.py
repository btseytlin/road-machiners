"""One broken end of an old concrete road bridge, for the 'bridgeSpan' landmark.

Sized for the 1.5-tile reference radius, 6 m. The origin is the bank top where the road meets the bridge.
The abutment sits on the bank behind the origin, from -5 m to -1.5 m along X. The deck stub runs 5 m
toward +X, across the gap, and snaps off with rebar sticking out. The deck is 7 m wide along Y. Its pier
and the fallen chunks reach 4 m below the origin, down into the wash.
Run: blender --background --python tools/blender/bridge_broken.py -- public/models/bridge_broken.glb [tmp/bridge_broken.png]
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
    "concrete": 0x9A8A78,  # PAL.rock.top
    "concrete_side": 0x6E6254,  # PAL.rock.side
    "concrete_dark": 0x4E453C,  # PAL.rock.dark
    "asphalt": 0x9C6C4C,  # PAL.roadCrack
    "line": 0xF0E0B8,  # PAL.plan
    "rebar": 0x3A2418,  # PAL.rust.dark
    "rust": 0x8A4A2A,  # PAL.rust.top
}
SEED = 23

WIDTH = 7.0  # Y
DECK_TOP = 0.3
DECK_THICK = 0.7
STUB_END = 5.0  # X where the longest deck strip breaks off
BOTTOM = -4.0
PARAPET_H = 0.8
SAG = math.radians(4)  # the stub droops toward the break


def abutment(kit: Kit) -> None:
    """The concrete block the deck rests on, with wing walls holding the bank on both sides."""
    kit.box("abutment", (3.5, WIDTH + 0.6, DECK_TOP - BOTTOM + 1.0), (-3.25, 0, (DECK_TOP + BOTTOM) / 2 - 0.5), "concrete", dent_by=0.06)
    kit.box("approach", (3.4, WIDTH - 0.1, 0.06), (-3.25, 0, DECK_TOP + 0.03), "asphalt", dent_by=0.02)
    kit.box("seat", (1.0, WIDTH + 0.4, 0.5), (-1.5, 0, DECK_TOP - DECK_THICK - 0.1), "concrete_dark")
    for side in (-1, 1):
        y = side * (WIDTH / 2 + 0.5)
        kit.box(f"wing_{side}", (4.5, 0.6, 1.3), (-4.0, y, 0.2), "concrete", rot=(0, 0, side * math.radians(-12)), dent_by=0.06)


def deck(kit: Kit) -> None:
    """The road deck: strips of different length make a ragged break, each sagging a little more."""
    strips = [(-1.5, STUB_END - 0.8), (-1.5, STUB_END), (-1.5, STUB_END - 2.0), (-1.5, STUB_END - 1.2)]
    strip_w = WIDTH / len(strips)
    for i, (x0, x1) in enumerate(strips):
        y = -WIDTH / 2 + strip_w * (i + 0.5)
        length = x1 - x0
        sag = SAG * (1 + i % 2 * 0.5)
        cx = (x0 + x1) / 2
        cz = DECK_TOP - DECK_THICK / 2 - math.sin(sag) * length / 2
        kit.box(f"slab{i}", (length, strip_w + 0.02, DECK_THICK), (cx, y, cz), "concrete", rot=(0, sag, 0), dent_by=0.05)
        # Asphalt skin on the slab top, with a worn center line on the two middle strips.
        kit.box(f"asphalt{i}", (length - 0.1, strip_w - 0.05, 0.06), (cx, y, cz + DECK_THICK / 2 + 0.03), "asphalt", rot=(0, sag, 0), dent_by=0.02)
        # Rebar ends sticking out of the break, bent down.
        end_z = DECK_TOP - math.sin(sag) * length - DECK_THICK / 2
        for j in range(3):
            by = y + (j - 1) * strip_w * 0.3
            reach = kit.rng.uniform(0.6, 1.4)
            droop = kit.rng.uniform(0.2, 0.9)
            strut(kit, f"rebar{i}_{j}", (x1 - 0.1, by, end_z), (x1 + reach, by + kit.rng.uniform(-0.3, 0.3), end_z - droop), 0.07, "rebar")
    for k in range(4):
        kit.box(f"dash{k}", (0.7, 0.18, 0.02), (-0.8 + k * 1.4, 0, DECK_TOP + 0.07 - math.sin(SAG) * (k * 1.4 + 0.7)), "line", rot=(0, SAG, 0))
    kit.box("beam_under", (STUB_END - 1.5, WIDTH - 1.6, 0.6), ((STUB_END - 3.0) / 2 + 0.3, 0, DECK_TOP - DECK_THICK - 0.35), "concrete_dark", rot=(0, SAG, 0), dent_by=0.04)


def parapets(kit: Kit) -> None:
    """Low concrete side walls. The left one stops short with a bent rail, the right one runs to the break."""
    z = DECK_TOP + PARAPET_H / 2
    kit.box("parapet_r", (STUB_END - 1.0, 0.35, PARAPET_H), ((STUB_END - 1.0) / 2 - 1.5, WIDTH / 2 - 0.18, z - 0.2), "concrete", rot=(0, SAG, 0), dent_by=0.05)
    kit.box("parapet_l", (3.0, 0.35, PARAPET_H), (0.0, -WIDTH / 2 + 0.18, z - 0.05), "concrete", rot=(0, SAG * 0.6, 0), dent_by=0.05)
    strut(kit, "rail_bent", (1.5, -WIDTH / 2 + 0.18, DECK_TOP + 0.6), (3.6, -WIDTH / 2 - 0.6, DECK_TOP - 0.6), 0.12, "rust")


def pier(kit: Kit) -> None:
    """One pier under the stub, standing in the wash, with its cap and a cracked chunk at its foot."""
    x = 2.0
    top = DECK_TOP - DECK_THICK - 0.65
    height = top - BOTTOM
    for side in (-1, 1):
        kit.box(f"column_{side}", (1.0, 1.0, height), (x, side * 2.0, BOTTOM + height / 2), "concrete_side", dent_by=0.04)
    kit.box("pier_cap", (1.3, WIDTH - 1.0, 0.6), (x, 0, top), "concrete", dent_by=0.03)
    kit.box("pier_band", (1.04, 1.04, 0.25), (x, -2.0, BOTTOM + 1.2), "concrete_dark")


def fallen(kit: Kit) -> None:
    """Slab pieces that dropped off the far end into the wash below."""
    pieces = [(5.2, -1.2, 2.4, 1.8), (5.8, 1.6, 2.0, 1.5), (4.6, 2.8, 1.3, 1.0)]
    for i, (x, y, w, d) in enumerate(pieces):
        rot = (kit.rng.uniform(-0.5, 0.5), kit.rng.uniform(-0.6, 0.6), kit.rng.uniform(0, math.pi))
        kit.box(f"fallen{i}", (w, d, 0.6), (x, y, BOTTOM + 0.3), "concrete" if i % 2 else "concrete_side", rot=rot, dent_by=0.08)


def build(kit: Kit) -> None:
    abutment(kit)
    deck(kit)
    parapets(kit)
    pier(kit)
    fallen(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("bridge_broken", args, view_size=20)


if __name__ == "__main__":
    main()
