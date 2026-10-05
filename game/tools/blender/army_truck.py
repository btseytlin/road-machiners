"""Derelict 6x6 army cargo truck with a canvas-covered bed, for the old army farm's motor pool and road.

Built to a 1.1-tile reference radius, 4.4 m: 8 m long along X, 2.5 m wide, 3.2 m tall at the canvas top, so its
corners reach 4.3 m. Wheel radius 0.55 m on three axles. The cab faces +X.
Run: blender --background --python tools/blender/army_truck.py -- public/models/army_truck.glb [tmp/army_truck.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, Vec3, parse_args  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "paint": 0xA89A70,  # FACTION_COLORS.nose.cab, faded khaki
    "paint_side": 0x7E7452,  # FACTION_COLORS.nose.cabSide
    "canvas": 0x8E7454,  # PAL.wall.side, the concept's sun-faded tan canvas
    "canvas_dark": 0x6A5840,  # PAL.wall.dark
    "metal": 0x5A5A58,  # PAL.metal
    "rust": 0x5E3420,  # PAL.rust.side
    "wheel": 0x2A2420,  # PAL.wheel
    "glass": 0x2A1A10,  # PAL.shadow, empty window holes
}
SEED = 73
AXLE: Vec3 = (math.radians(90), 0, 0)
WHEEL_R = 0.55  # m
TRACK = 0.95  # m, wheel centre from the middle across Y
AXLES = (2.5, -1.4, -2.8)  # m along X: front, then the rear tandem
HALF_W = 1.25  # m, half the body's width


def wheel(kit: Kit, name: str, x: float, y: float) -> None:
    kit.cylinder(name, WHEEL_R, 0.42, (x, y, WHEEL_R), "wheel", rot=AXLE, vertices=8, dent_by=0.02)
    kit.cylinder(name + "_hub", WHEEL_R * 0.45, 0.46, (x, y, WHEEL_R), "metal", rot=AXLE, vertices=6)


def build(kit: Kit) -> None:
    # Ladder frame under the whole length.
    for side in (-0.45, 0.45):
        kit.box(f"rail{side:+.1f}", (7.6, 0.16, 0.25), (-0.1, side, 0.95), "metal")
    for i, x in enumerate(AXLES):
        for s in (-1, 1):
            wheel(kit, f"wheel{i}{s:+d}", x, s * TRACK)
    # Hood, grille and front fenders.
    kit.box("hood", (1.4, 1.9, 0.75), (3.25, 0, 1.55), "paint", dent_by=0.03)
    kit.box("grille", (0.12, 1.5, 0.7), (3.98, 0, 1.45), "metal")
    kit.box("bumper", (0.2, 2.4, 0.25), (4.0, 0, 0.85), "metal", dent_by=0.02)
    for s in (-1, 1):
        kit.box(f"fender{s:+d}", (1.3, 0.5, 0.12), (2.6, s * 1.0, 1.25), "paint_side", rot=(0, math.radians(-8), 0), dent_by=0.02)
    # Cab with dark window holes, roof slightly crushed.
    kit.box("cab", (1.3, HALF_W * 2, 1.5), (1.9, 0, 1.9), "paint", dent_by=0.04)
    kit.box("cab_roof", (1.2, HALF_W * 2 - 0.1, 0.12), (1.85, 0, 2.7), "paint_side", rot=(math.radians(3), 0, 0), dent_by=0.03)
    kit.box("windshield", (0.06, 2.0, 0.55), (2.56, 0, 2.25), "glass")
    for s in (-1, 1):
        kit.box(f"side_window{s:+d}", (0.7, 0.06, 0.5), (1.95, s * (HALF_W + 0.01), 2.25), "glass")
    # Cargo bed with low side walls under a canvas cover on hoops.
    kit.box("bed_floor", (5.0, HALF_W * 2, 0.15), (-1.3, 0, 1.2), "paint_side", dent_by=0.02)
    for s in (-1, 1):
        kit.box(f"bed_side{s:+d}", (5.0, 0.08, 0.6), (-1.3, s * (HALF_W - 0.04), 1.55), "paint", dent_by=0.03)
    kit.box("tailgate", (0.08, HALF_W * 2, 0.6), (-3.8, 0, 1.55), "paint_side", dent_by=0.03)
    kit.box("canvas", (4.9, HALF_W * 2 - 0.04, 1.3), (-1.35, 0, 2.5), "canvas", dent_by=0.06)
    kit.box("canvas_top", (4.9, HALF_W * 2 - 0.5, 0.15), (-1.35, 0, 3.2), "canvas", dent_by=0.03)
    for i in range(4):
        x = -3.6 + i * 1.5
        kit.box(f"hoop{i}", (0.1, HALF_W * 2 + 0.04, 0.08), (x, 0, 3.17), "canvas_dark")
    # A torn flap hanging off the back, and the rear fenders over the tandem.
    kit.box("flap", (0.06, 1.2, 0.9), (-3.85, 0.4, 2.3), "canvas_dark", rot=(0.2, math.radians(-15), 0), dent_by=0.04)
    for s in (-1, 1):
        kit.box(f"rear_fender{s:+d}", (2.6, 0.5, 0.08), (-2.1, s * 1.0, 1.18), "rust")
    # Spare wheel and a fuel can behind the cab.
    kit.cylinder("spare", WHEEL_R * 0.9, 0.35, (1.05, HALF_W - 0.35, 1.9), "wheel", rot=(0, math.radians(90), 0), vertices=8)
    kit.box("jerrycan", (0.3, 0.18, 0.45), (1.1, -HALF_W + 0.2, 1.5), "canvas")


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("army_truck", args, view_size=11)


if __name__ == "__main__":
    main()
