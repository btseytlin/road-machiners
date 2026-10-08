"""Dustwell's pumpjack walking beam (C2): an I-beam with the curved horsehead and its bridle at +X, and the equalizer
with two pitman arms at the tail. It rocks about Y at pumpjack_base's socket_beam.

Built at its in-game size. The origin is the rocking axis at the saddle bearing. The beam runs from X = -5.9 to the
horsehead face, an arc of radius 7.0 m about the origin from 3.4 m below to 1.5 m above it. The bridle hangs 7 m
from the arc's front, and the pitman arms hang 4 m from the equalizer at X = -5.5 to the crank pins of
pumpjack_base, outside its counterweight discs (Y = +-1.5).
Run: blender --background --python tools/blender/pumpjack_beam.py -- public/models/pumpjack_beam.glb [tmp/pumpjack_beam.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import prism, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top, C2's orange horsehead
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "tin": 0x8A8A84,  # PAL.metalLight
}
SEED = 72

TAIL = -5.9
HEAD_BACK = 5.0  # where the horsehead plate starts
RADIUS = 7.0  # the horsehead face arc, about the bearing
ARC = (-29.0, 12.0)  # degrees of the face arc, down and up from level
BRIDLE = 7.0
PITMAN = (-5.5, 1.5, 4.0)  # X, half spread in Y, length down to the crank pins
WIDTH = 0.8  # horsehead plate thickness across Y


def horsehead(kit: Kit) -> None:
    lo, hi = (math.radians(a) for a in ARC)
    face = [(RADIUS * math.cos(lo + (hi - lo) * k / 6), RADIUS * math.sin(lo + (hi - lo) * k / 6)) for k in range(7)]
    profile = [*face, (HEAD_BACK + 0.2, 1.3), (HEAD_BACK, 0.2), (HEAD_BACK + 0.5, -2.6)]
    prism(kit, "horsehead", profile, -WIDTH / 2, WIDTH / 2, "rust")
    # A dark groove band on the face where the bridle runs, and the face rim.
    groove = [(x + 0.06 * math.cos(math.atan2(z, x)), z + 0.06 * math.sin(math.atan2(z, x))) for x, z in face]
    for i, (a, b) in enumerate(zip(groove, groove[1:])):
        strut(kit, f"groove{i}", (a[0], 0, a[1]), (b[0], 0, b[1]), 0.3, "rust_dark")
    for side in (-1, 1):
        kit.box(f"head_brace{side}", (1.6, 0.06, 0.2), (HEAD_BACK + 0.8, side * (WIDTH / 2 + 0.03), -1.0), "rust_side", rot=(0, 0.9, 0))
    # The bridle: two wire lines from the face down to the carrier bar.
    for side in (-1, 1):
        kit.box(f"bridle{side}", (0.05, 0.05, BRIDLE), (RADIUS + 0.08, side * 0.18, -BRIDLE / 2), "metal")
    kit.box("carrier", (0.3, 0.7, 0.2), (RADIUS + 0.08, 0, -BRIDLE), "rust_dark")


def build(kit: Kit) -> None:
    # The I-beam: web and two flanges, sitting on the bearing.
    kit.box("web", (HEAD_BACK - TAIL + 0.3, 0.12, 1.0), ((HEAD_BACK + TAIL) / 2, 0, 0.7), "metal", dent_by=0.01)
    for z in (0.22, 1.18):
        kit.box(f"flange{z}", (HEAD_BACK - TAIL + 0.3, 0.6, 0.12), ((HEAD_BACK + TAIL) / 2, 0, z), "metal")
    kit.box("bearing_cap", (1.0, 0.9, 0.5), (0, 0, 0.0), "rust_dark")
    for i, x in enumerate((-3.6, -1.4, 1.4, 3.4)):
        kit.box(f"stiffener{i}", (0.1, 0.56, 0.9), (x, 0, 0.7), "rust_side")
    horsehead(kit)
    # The equalizer across the tail, and the pitman arms down to the crank pins.
    px, spread, length = PITMAN
    kit.box("equalizer", (0.5, 2 * spread + 0.3, 0.4), (px, 0, 0.0), "rust_side")
    kit.box("tail_cap", (0.5, 0.7, 1.2), (TAIL + 0.2, 0, 0.7), "rust")
    for side in (-1, 1):
        strut(kit, f"pitman{side}", (px, side * spread, 0.0), (px, side * spread, -length), 0.24, "rust", dent_by=0.01)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("pumpjack_beam", args, view_size=16.0)


if __name__ == "__main__":
    main()
