"""Salvage Yard's crane upper (C4): the slewing deck with a rust plate machinery house, a lit operator cab, a
counterweight, a roof A-frame and a steep lattice boom with its pendant lines. It slews on crane_base's socket_slew,
and crane_grab hangs from socket_hook.

Built at its in-game size. The origin is the slew axis at the slew ring top, and the boom points +X. The deck runs
from X = -4.0 (the counterweight) to 2.6 (the cab front), 3.6 m wide, and the house tops out at 4.6 m. The boom foot
pin is at X = 1.8, 1.4 m up, and the 14 m boom rises at 65 degrees to its head at X = 7.72, Z = 14.09. The tip
sheave center, 0.3 m further out at X = 8.02, is where socket_hook marks the hoist line. Two hoist lines hang 3.2 m
from it: the grab's own 2 m slack lines meet them with the hook 5.2 m below the sheave at rest (the 2 m hoist's lowest
point).
Run: blender --background --python tools/blender/crane_upper.py -- public/models/crane_upper.glb [tmp/crane_upper.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "metal": 0x5A5A58,  # PAL.metal
    "steel": 0x2A2420,  # PAL.wheel
    "weight": 0x86867E,  # FACTION_COLORS.convoys.side, cast counterweight blocks
    "glow": 0xFFF2C8,  # PAL.lamp.on, the lit windows
}
SEED = 82

DECK = (-4.0, 2.6, 1.8, 0.5)  # x from, x to, half width, top
HOUSE = (-3.0, 1.0, 1.7, 4.6)  # x from, x to, half width, top
CAB = (1.0, 2.6, 0.75, 1.8, 3.4)  # x from, x to, y from, y to, top
FOOT = Vector((1.8, 0.0, 1.4))
BOOM_LENGTH = 14.0
BOOM_ANGLE = math.radians(65)
BOOM_SECTION = ((1.2, 1.0), (0.6, 0.5))  # (across Y, depth) at the foot and at the tip
BAYS = 9
CABLE = 3.2  # the fixed hoist lines below the tip; the grab's 2 m slack lines carry on to the hook
APEX = (-0.8, 1.2, 7.2)  # the A-frame top, x, half spread, z


def plates(kit: Kit, name: str, x0: float, x1: float, y: float, z0: float, z1: float) -> None:
    """Dented rust plates proud of one long side of the house, in uneven widths and shades."""
    x = x0
    i = 0
    while x < x1 - 0.2:
        w = min(kit.rng.uniform(0.8, 1.4), x1 - x)
        kit.box(f"{name}{i}", (w - 0.06, 0.06, z1 - z0 - kit.rng.uniform(0.1, 0.5)), (x + w / 2, y, (z0 + z1) / 2 - 0.1),
                kit.rng.choice(("rust_side", "rust", "rust_dark", "rust_side")), dent_by=0.03)
        x += w
        i += 1


def house(kit: Kit) -> None:
    x0, x1, dy, deck = DECK
    kit.box("deck", (x1 - x0, 2 * dy, deck), ((x0 + x1) / 2, 0, deck / 2), "steel")
    kit.cylinder("turntable", 1.6, 0.4, (0, 0, -0.1), "metal", vertices=12)
    hx0, hx1, hy, top = HOUSE
    kit.box("house", (hx1 - hx0, 2 * hy, top - deck), ((hx0 + hx1) / 2, 0, (deck + top) / 2), "rust_side", dent_by=0.03)
    for side in (-1, 1):
        plates(kit, f"plate{side}_", hx0, hx1, side * (hy + 0.03), deck, top)
        # Two lit windows along each side, as C4's house glows from its side.
        for i, x in enumerate((-2.2, -0.6)):
            kit.box(f"window{side}{i}", (0.7, 0.08, 0.7), (x, side * (hy + 0.07), top - 1.5), "glow")
            kit.box(f"hood{side}{i}", (0.9, 0.3, 0.08), (x, side * (hy + 0.15), top - 1.08), "rust_dark")
    kit.box("roof", (hx1 - hx0 + 0.3, 2 * hy + 0.3, 0.2), ((hx0 + hx1) / 2, 0, top + 0.1), "rust_dark")
    kit.box("winch", (1.4, 1.6, 0.8), (-1.6, 0, top + 0.6), "metal")
    kit.cylinder("drum", 0.4, 1.8, (0.0, 0, top + 0.6), "steel", rot=(math.pi / 2, 0, 0), vertices=8)
    kit.box("exhaust", (0.25, 0.25, 1.4), (-2.6, -1.2, top + 0.8), "steel")
    # The operator cab at the boom foot, glazed at its front and outer side.
    cx0, cx1, cy0, cy1, ctop = CAB
    kit.box("cab", (cx1 - cx0, cy1 - cy0, ctop - deck), ((cx0 + cx1) / 2, (cy0 + cy1) / 2, (deck + ctop) / 2), "rust", dent_by=0.02)
    kit.box("cab_front", (0.08, cy1 - cy0 - 0.3, 1.1), (cx1 + 0.03, (cy0 + cy1) / 2, ctop - 0.9), "glow")
    kit.box("cab_side", (cx1 - cx0 - 0.4, 0.08, 1.0), ((cx0 + cx1) / 2, cy1 + 0.03, ctop - 0.85), "glow")
    kit.box("cab_roof", (cx1 - cx0 + 0.2, cy1 - cy0 + 0.2, 0.15), ((cx0 + cx1) / 2, (cy0 + cy1) / 2, ctop + 0.07), "rust_dark")
    # The counterweight: three cast blocks across the tail.
    for i, y in enumerate((-1.1, 0.0, 1.1)):
        kit.box(f"weight{i}", (0.95, 1.05, 2.4), (x0 + 0.5, y, deck + 1.2), "weight", dent_by=0.03)
    kit.box("weight_strap", (1.0, 2 * dy, 0.2), (x0 + 0.5, 0, deck + 2.5), "rust_dark")


def gantry(kit: Kit) -> None:
    ax, ay, az = APEX
    top = HOUSE[3]
    for side in (-1, 1):
        for x in (-2.4, 0.6):
            strut(kit, f"aframe{side}{x}", (x, side * 1.45, top), (ax, side * ay, az), 0.22, "rust_dark")
    kit.box("apex", (0.4, 2 * ay + 0.4, 0.4), (ax, 0, az), "rust_dark")


def boom(kit: Kit) -> Vector:
    """The lattice boom from the foot pin to the tip. Returns the tip sheave center."""
    along = Vector((math.cos(BOOM_ANGLE), 0, math.sin(BOOM_ANGLE)))
    depth_dir = Vector((-math.sin(BOOM_ANGLE), 0, math.cos(BOOM_ANGLE)))  # square to the boom in its plane
    across = Vector((0, 1, 0))

    def corner(t: float, i: int, j: int) -> Vector:
        w = BOOM_SECTION[0][0] + (BOOM_SECTION[1][0] - BOOM_SECTION[0][0]) * t
        d = BOOM_SECTION[0][1] + (BOOM_SECTION[1][1] - BOOM_SECTION[0][1]) * t
        return FOOT + along * (BOOM_LENGTH * t) + across * (i * w / 2) + depth_dir * (j * d / 2)

    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i, j in corners:
        strut(kit, f"chord{i}{j}", tuple(corner(0, i, j)), tuple(corner(1, i, j)), 0.16, "rust_dark")
    for k in range(BAYS):
        t0, t1 = k / BAYS, (k + 1) / BAYS
        for f, (a, b) in enumerate(zip(corners, corners[1:] + corners[:1])):
            # Zigzag lacing on each face, and a batten ring at each bay end.
            p0 = corner(t0, *a) if k % 2 == 0 else corner(t0, *b)
            p1 = corner(t1, *b) if k % 2 == 0 else corner(t1, *a)
            strut(kit, f"lace{k}{f}", tuple(p0), tuple(p1), 0.07, "rust_side")
            strut(kit, f"batten{k}{f}", tuple(corner(t1, *a)), tuple(corner(t1, *b)), 0.07, "rust_side")
    kit.box("foot_pin", (0.5, 1.6, 0.5), tuple(FOOT), "steel")
    tip = FOOT + along * BOOM_LENGTH
    kit.box("head", (0.9, 0.9, 0.7), tuple(tip), "rust", rot=(0, -BOOM_ANGLE, 0))
    kit.cylinder("sheave", 0.45, 0.5, tuple(tip + Vector((0.3, 0, 0))), "steel", rot=(math.pi / 2, 0, 0), vertices=10)
    ax, ay, az = APEX
    for side in (-1, 1):
        strut(kit, f"pendant{side}", (ax, side * ay, az), tuple(tip + Vector((-0.2, side * 0.3, 0.3))), 0.06, "metal")
    return tip + Vector((0.3, 0, 0))


def build(kit: Kit) -> None:
    house(kit)
    gantry(kit)
    hook = boom(kit)
    for side in (-1, 1):
        kit.box(f"line{side}", (0.06, 0.06, CABLE), (hook.x, side * 0.15, hook.z - CABLE / 2), "metal")
    kit.socket("hook", tuple(hook))


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("crane_upper", args, view_size=18.0)


if __name__ == "__main__":
    main()
