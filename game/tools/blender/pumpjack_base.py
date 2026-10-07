"""Dustwell's water pumpjack, the static part (C2): an A-frame samson post, a high crank with two counterweight discs, a
corrugated motor house and the wellhead. The walking beam is pumpjack_beam, which rocks at socket_beam.

Built at its in-game size, 1.45x C2 so it rises over the 12 m wall: the saddle bearing on the post top is at 14.5 m,
where socket_beam marks the rocking axis (along Y). +X points to the horsehead and the wellhead at X = 7, -X to the
crank at X = -5.5 (axis 9 m up) and the motor house, which ends at X = -8.8. The model is 4.4 m wide (Y), and its
footprint runs from X = -8.8 to 8.0. Origin at the ground under the bearing.
Run: blender --background --python tools/blender/pumpjack_base.py -- public/models/pumpjack_base.glb [tmp/pumpjack_base.png]
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
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "tin": 0x8A8A84,  # PAL.metalLight, the motor house corrugation
    "concrete": 0x86867E,  # FACTION_COLORS.convoys.side
}
SEED = 71

BEARING = 14.5
CRANK = (-5.5, 9.0)  # X and Z of the crank shaft
DISC = 2.2  # counterweight disc radius
DISC_Y = 1.05  # disc centers either side of the gearbox
PIN = 1.5  # crank pin radius on the disc
WELL_X = 7.0
LEG_FOOT = (2.3, -2.4)  # X of the front and back leg feet
LEG_SPREAD = 1.7  # half the leg spread across Y at the feet
LEG_TOP = 0.35  # half the leg spread across X and Y at the bearing


def leg(foot_x: float, side: int, z: float) -> tuple[float, float, float]:
    """A point on a samson post leg at height z, from its foot toward the bearing."""
    k = z / (BEARING - 0.7)
    top_x = math.copysign(LEG_TOP, foot_x)
    return (foot_x + (top_x - foot_x) * k, side * (LEG_SPREAD + (LEG_TOP - LEG_SPREAD) * k), z)


def samson_post(kit: Kit) -> None:
    for fx in LEG_FOOT:
        for side in (-1, 1):
            strut(kit, f"leg{fx}{side}", leg(fx, side, 0.3), leg(fx, side, BEARING - 0.7), 0.42, "rust", dent_by=0.02)
    for i, z in enumerate((2.6, 5.4, 8.2, 11.0, 13.0)):
        for side in (-1, 1):
            strut(kit, f"tie{i}{side}", leg(LEG_FOOT[0], side, z), leg(LEG_FOOT[1], side, z), 0.2, "rust_side")
        for fx in LEG_FOOT:
            strut(kit, f"cross{i}{fx}", leg(fx, -1, z), leg(fx, 1, z), 0.2, "rust_side")
    for i, (z0, z1) in enumerate(((0.6, 5.2), (5.6, 10.8), (11.2, 13.4))):
        for side in (-1, 1):
            strut(kit, f"brace{i}{side}", leg(LEG_FOOT[0], side, z0), leg(LEG_FOOT[1], side, z1), 0.14, "rust_dark")
    # A ladder up the front legs, its rails parallel to them.
    for side in (-1, 1):
        a = leg(LEG_FOOT[0], 0, 0.3)
        b = leg(LEG_FOOT[0], 0, BEARING - 1.2)
        strut(kit, f"ladder_rail{side}", (a[0] + 0.25, side * 0.35, a[2]), (b[0] + 0.25, side * 0.35, b[2]), 0.07, "metal")
    for i in range(1, 19):
        p = leg(LEG_FOOT[0], 0, 0.3 + i * (BEARING - 1.5) / 19)
        kit.box(f"rung{i}", (0.05, 0.7, 0.05), (p[0] + 0.25, 0, p[2]), "metal")
    kit.box("saddle", (1.2, 1.2, 0.7), (0, 0, BEARING - 0.35), "metal")
    kit.cylinder("bearing", 0.35, 1.3, (0, 0, BEARING - 0.05), "rust_dark", rot=(math.pi / 2, 0, 0), vertices=8)


def crank(kit: Kit) -> None:
    cx, cz = CRANK
    # A steel pedestal lifts the gearbox, as C2's crank sits high on the post side.
    for px in (cx - 1.6, cx + 1.4):
        for py in (-0.6, 0.6):
            kit.box(f"pedestal{px}{py}", (0.35, 0.35, cz - 1.6), (px, py, (cz - 1.6) / 2 + 0.3), "metal")
    kit.box("platform", (4.4, 1.5, 0.3), (cx - 0.3, 0, cz - 1.4), "metal")
    for py in (-0.6, 0.6):
        strut(kit, f"pedestal_brace{py}", (cx - 1.6, py, 0.5), (cx + 1.4, py, cz - 1.7), 0.14, "metal")
    kit.box("gearbox", (2.0, 1.3, 2.2), (cx, 0, cz - 0.2), "rust_side", dent_by=0.02)
    kit.cylinder("shaft", 0.22, 2 * DISC_Y + 0.6, (cx, 0, cz), "metal", rot=(math.pi / 2, 0, 0), vertices=8)
    for side in (-1, 1):
        y = side * DISC_Y
        kit.cylinder(f"disc{side}", DISC, 0.3, (cx, y, cz), "rust", rot=(math.pi / 2, 0, 0), vertices=14, dent_by=0.02)
        kit.cylinder(f"disc_rim{side}", DISC + 0.06, 0.18, (cx, y + side * 0.06, cz), "rust_dark", rot=(math.pi / 2, 0, 0), vertices=14)
        for k in range(4):
            a = k * math.pi / 4
            kit.box(f"spoke{side}{k}", (2 * DISC - 0.3, 0.08, 0.22), (cx, y + side * 0.19, cz), "tin", rot=(0, a, 0))
        kit.cylinder(f"pin{side}", 0.2, 0.5, (cx, y + side * 0.3, cz + PIN), "metal", rot=(math.pi / 2, 0, 0), vertices=6)
    # The corrugated motor house on the pedestal's far end, and the belt guard to the gearbox.
    mx = cx - 2.4
    kit.box("motor_house", (1.8, 1.9, 2.2), (mx, 0, cz - 0.15), "tin", dent_by=0.02)
    for k in range(9):
        y = -0.8 + k * 0.2
        kit.box(f"motor_rib{k}", (1.86, 0.06, 2.2), (mx, y, cz - 0.15), "tin" if k % 2 else "rust_side")
    kit.box("motor_roof", (2.1, 2.2, 0.15), (mx, 0, cz + 1.0), "rust", rot=(0, 0.08, 0), dent_by=0.02)
    kit.box("belt_guard", (1.6, 0.3, 0.9), (cx - 1.3, -0.75, cz - 0.2), "rust_dark")


def wellhead(kit: Kit) -> None:
    kit.box("well_pad", (2.0, 2.0, 0.4), (WELL_X, 0, 0.1), "concrete", dent_by=0.02)
    kit.cylinder("casing", 0.3, 1.6, (WELL_X, 0, 1.0), "metal", vertices=8)
    kit.cylinder("tee", 0.18, 1.6, (WELL_X, 0, 1.4), "metal", rot=(math.pi / 2, 0, 0), vertices=6)
    kit.cylinder("valve", 0.32, 0.08, (WELL_X, 0.8, 1.4), "rust", rot=(math.pi / 2, 0, 0), vertices=8)
    kit.cylinder("stuffing_box", 0.2, 0.5, (WELL_X, 0, 2.05), "rust_dark", vertices=6)
    # The polished rod reaches to below the lowest stroke of the bridle's carrier bar.
    kit.cylinder("polished_rod", 0.06, 2.6, (WELL_X, 0, 2.3 + 1.3), "tin", vertices=4)


def build(kit: Kit) -> None:
    kit.box("pad", (12.0, 4.4, 0.5), (-2.8, 0, 0.0), "concrete", dent_by=0.03)
    for side in (-1, 1):
        kit.box(f"skid{side}", (11.0, 0.3, 0.35), (-2.6, side * 1.75, 0.4), "rust_dark")
    samson_post(kit)
    crank(kit)
    wellhead(kit)
    kit.socket("beam", (0.0, 0.0, BEARING))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("pumpjack_base", args, view_size=20.0)


if __name__ == "__main__":
    main()
