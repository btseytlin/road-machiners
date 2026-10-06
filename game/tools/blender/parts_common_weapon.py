"""Shared layout and helpers for the weapon sub-part scripts `wmount_*`, `wrec_*`, `wbar_*` and `wext_*`.

The game assembles a weapon from four models joined at sockets:

- A mount fills its footprint, w cells across (Blender Y) by one cell along (Blender X). Its origin is the footprint
  center on the deck top. It carries `socket_head` at the turret pivot on top. Mounts do not turn.
- A receiver has its origin at the pivot and faces +X. It carries `socket_muzzle` at the center of its front face and
  `socket_extra` on the top front edge, centered in Y.
- A barrel has its origin at its rear end, centered in Y and Z, and runs along +X. It carries `socket_tip` at the center of its front end, where rounds leave.
- An extra has its origin at the top front edge of the receiver. A shield rises from there. A scope and a drum reach
  back from there.
"""

from __future__ import annotations

import math
from collections.abc import Callable

from kit import CELL_ACROSS, CELL_ALONG, Kit, Vec3, parse_args

ALONG_X: Vec3 = (0, math.radians(90), 0)  # Turns a Kit cylinder so its axis runs along +X, local +Z to the front.

# Colors from src/render/palette.ts. The view swaps `paint` for the faction color.
COLORS = {
    "paint": 0x9C7A3E,  # FACTION_COLORS.player.top
    "metal": 0x5A5A58,  # PAL.metal
    "metal_light": 0x8A8A84,  # PAL.metalLight
    "dark": 0x2A2420,  # PAL.wheel
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "brass": 0xF0D060,  # PAL.select
    "warhead": 0xE05030,  # PAL.dest
    "lens": 0x6AAAA0,  # PAL.waterLight
    "rope": 0xC9B98A,  # PAL.rope
}


def tube(kit: Kit, name: str, radius: float, x0: float, x1: float, mat: str, y: float = 0.0, z: float = 0.0, sides: int = 8, dent_by: float = 0.0):
    """A cylinder along X from x0 to x1. Its local +Z end is the front end, for shapes.taper."""
    return kit.cylinder(name, radius, x1 - x0, ((x0 + x1) / 2, y, z), mat, rot=ALONG_X, vertices=sides, dent_by=dent_by)


def base_plate(kit: Kit, cells_across: int, mat: str = "metal") -> None:
    """A thin deck plate that fills the footprint, with bolt heads at the corners."""
    across = cells_across * CELL_ACROSS
    kit.box("base_plate", (CELL_ALONG - 0.04, across - 0.04, 0.04), (0, 0, 0.02), mat, dent_by=0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            kit.box(f"bolt{sx}{sy}", (0.04, 0.04, 0.03), (sx * (CELL_ALONG / 2 - 0.07), sy * (across / 2 - 0.06), 0.05), "metal_light")


def run(name: str, build: Callable[[Kit], None], seed: int, preview_m: float) -> None:
    """Builds one weapon sub-part and exports it with its preview."""
    args = parse_args()
    kit = Kit(COLORS, seed)
    build(kit)
    kit.export(name, args, view_size=preview_m)


def yoke(kit: Kit, across: float, cheek_h: float, along: float = 0.12) -> None:
    """The pivot fork under a receiver: a turntable disc at the origin and two cheek plates up its sides."""
    kit.cylinder("yoke_disc", along * 0.7, 0.03, (0, 0, 0.015), "dark", vertices=8)
    for y in (-across / 2, across / 2):
        kit.box(f"yoke_cheek{y:.2f}", (along, 0.025, cheek_h), (0, y, cheek_h / 2), "dark")
