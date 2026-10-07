"""Shared colors and the build run for the utility part models `util_*.py`.

A utility model covers w cells across (Blender Y) by h cells along (Blender X, nose at +X), with its origin at the
footprint center on the deck top. Utilities are mostly worn metal with a mustard hint, the color of the utility kind
on the inventory grid.
"""

from __future__ import annotations

from collections.abc import Callable

from kit import Kit, parse_args
from parts_common_core import COLORS as CORE_COLORS
from parts_common_core import check_footprint

# Colors from src/render/palette.ts, on top of the core part colors.
COLORS = {
    **CORE_COLORS,
    "mustard": 0xB39A3A,  # PAL.utility
    "spark": 0x9FD8FF,  # PAL.pulse.ring
    "flare": 0xFF4A3A,  # PAL.flare.glow
}


def run(name: str, build: Callable[[Kit], None], seed: int, w: int, h: int, view: float, max_z: float | None = None) -> None:
    """Builds one w x h utility, checks it stays inside its footprint and above the deck, and exports it."""
    args = parse_args()
    kit = Kit(COLORS, seed)
    build(kit)
    check_footprint(kit, name, w, h, max_z=max_z)
    kit.export(name, args, view_size=view)
