"""Granary grain elevator (C3): a two-tier receiving house where the conveyor arrives, a tall dark leg with lattice
corner posts and braces behind it, a head house on top of the leg and a distributor spout down toward the silos.

Built at its in-game size. The house is 4.6 m square and 6 m tall, with a 3.6 m upper tier to 9.4 m. The leg stands
at the house's back corner on the -Y side, 1.5 m square, to 24 m, and the head house sits on it to 26.8 m. The spout
runs from the head house about 4 m out to -Y and down to 20.4 m. The conveyor comes in at the +X face:
socket_belt_top is where the belt meets its hood on the upper tier, 7.6 m up, and socket_belt_foot is the belt's low
end, 0.8 m over the ground 12 m out along +X. The interior lays the belt between the two. Origin at the ground center of the house.
Run: blender --background --python tools/blender/grain_elevator.py -- public/models/grain_elevator.glb [tmp/grain_elevator.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import ladder, strut  # noqa: E402

# Colors from src/render/palette.ts.
COLORS = {
    "house": 0x8A8A84,  # PAL.metalLight, C3's pale corrugated house
    "pale": 0xB8B8B0,  # FACTION_COLORS.convoys.top
    "metal": 0x5A5A58,  # PAL.metal
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "hole": 0x2A1A10,  # PAL.shadow
    "pad": 0x6E6254,  # PAL.rock.side
}
SEED = 89

HOUSE = {"half": 2.3, "height": 6.0}
TIER = {"half": 1.8, "height": 3.4}
LEG = {"x": -1.6, "y": -1.6, "half": 0.75, "top": 24.0}
HEAD = {"size": (3.0, 2.6, 2.8)}
BELT_TOP = (-0.3 + TIER["half"] + 0.45, 0.0, 7.6)
BELT_FOOT = (12.0, 0.0, 0.8)
SPOUT_END = (-0.4, -5.6, 20.4)


def build(kit: Kit) -> None:
    h, ht = HOUSE["half"], HOUSE["height"]
    kit.box("pad", (2 * h + 0.8, 2 * h + 0.8, 0.3), (0, 0, 0.1), "pad", dent_by=0.03)
    kit.box("house", (2 * h, 2 * h, ht), (0, 0, ht / 2), "house", dent_by=0.04)
    # Corrugation ribs on the two faces the camera sees, and rust sheets.
    for i in range(7):
        t = -h + (i + 0.5) * 2 * h / 7
        kit.box(f"rib_x{i}", (0.06, 0.12, ht - 0.2), (h + 0.02, t, ht / 2), "metal")
        kit.box(f"rib_y{i}", (0.12, 0.06, ht - 0.2), (t, h + 0.02, ht / 2), "metal")
    kit.box("rust_x", (0.05, 1.6, 2.4), (h + 0.05, 1.1, 2.0), "rust", rot=(0.05, 0, 0), dent_by=0.08)
    kit.box("rust_y", (1.4, 0.05, 1.8), (-0.9, h + 0.05, 3.8), "rust_side", dent_by=0.08)
    kit.box("door", (0.08, 1.6, 2.6), (h + 0.06, -1.2, 1.3), "hole")
    th, tt = TIER["half"], TIER["height"]
    kit.box("tier", (2 * th, 2 * th, tt), (-0.3, -0.3, ht + tt / 2), "pale", dent_by=0.04)
    kit.box("tier_roof", (2 * th + 0.4, 2 * th + 0.4, 0.25), (-0.3, -0.3, ht + tt + 0.12), "rust_side", dent_by=0.03)
    kit.box("roof", (2 * h + 0.3, 2 * h + 0.3, 0.2), (0, 0, ht + 0.1), "rust", dent_by=0.03)
    kit.box("tier_window", (0.06, 1.2, 0.7), (-0.3 + th + 0.03, 0.2, ht + tt - 1.0), "hole")

    # The hood where the belt comes in.
    bx, _, bz = BELT_TOP
    kit.box("hood", (0.9, 1.7, 1.4), (bx - 0.45, 0, bz + 0.2), "rust_dark", dent_by=0.03)

    # The leg: a trunk with lattice corner posts and X braces every 3 m, a ladder, and the head house on top.
    lx, ly, lh, top = LEG["x"], LEG["y"], LEG["half"], LEG["top"]
    kit.box("trunk", (0.9, 0.9, top), (lx, ly, top / 2), "metal")
    posts = [(lx + sx * lh, ly + sy * lh) for sx in (-1, 1) for sy in (-1, 1)]
    for i, (x, y) in enumerate(posts):
        kit.box(f"post{i}", (0.2, 0.2, top), (x, y, top / 2), "rust_dark")
    for k, z in enumerate(range(3, int(top) - 1, 3)):
        for i, (a, b) in enumerate([(posts[0], posts[1]), (posts[2], posts[3]), (posts[0], posts[2]), (posts[1], posts[3])]):
            strut(kit, f"leg_brace{k}_{i}", (a[0], a[1], z - 3), (b[0], b[1], z), 0.1, "rust_dark")
    ladder(kit, "ladder", (lx + lh + 0.3, ly, ht + 0.2), top, 0.5, 0.0, "rust_dark")
    sx, sy, sz = HEAD["size"]
    kit.box("head", (sx, sy, sz), (lx, ly, top + sz / 2), "house", dent_by=0.04)
    kit.box("head_roof", (sx + 0.4, sy + 0.4, 0.25), (lx, ly, top + sz + 0.12), "rust", dent_by=0.03)
    kit.box("head_rust", (0.05, 1.0, 1.4), (lx + sx / 2 + 0.03, ly + 0.5, top + 1.2), "rust_side", dent_by=0.05)
    strut(kit, "spout", (lx, ly - sy / 2, top + 0.8), SPOUT_END, 0.45, "rust_side", sides=6)
    strut(kit, "spout_stay", (lx, ly - 0.5, top - 4.0), (SPOUT_END[0], SPOUT_END[1], SPOUT_END[2] + 0.4), 0.1, "metal")

    kit.socket("belt_top", BELT_TOP)
    kit.socket("belt_foot", BELT_FOOT)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("grain_elevator", args, view_size=14.0)


if __name__ == "__main__":
    main()
