"""Fallen Sun reactor: the cracked core of the crashed colony ship, standing in the breach of the bow.

Reference radius 8 m. A glowing rod 2.5 m in radius and 12 m tall stands inside a cracked shell of ten hull
staves 4.6 m out, with gaps and torn-off staves that leak its light, held by three bands, one of them broken.
A ring of short torn staves crowns the top. The rod is a separate "glow" material, which the game draws
emissive; everything else is hull. Nothing reaches past 8 m from the centre, so it fits inside the bow breach.
Run: blender --background --python tools/blender/reactor.py -- public/models/reactor.glb [tmp/reactor.png]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kit import Kit, parse_args  # noqa: E402
from shapes import taper  # noqa: E402

# Colors from src/render/palette.ts. soot is darker than any palette color.
COLORS = {
    "hull": 0xD6CFBF,  # PAL.hull.light
    "hull_grey": 0x9C978C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x8A4A2A,  # PAL.rust.top
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
    "glow": 0x5CF0B4,  # PAL.reactorGlow
}
SEED = 31

ROD_R = 2.5
ROD_H = 12.0
SHELL_R = 4.6  # m from the centre to the staves
STAVES = 10
TORN = {2, 6}  # staves torn away, so the rod shows from both sides
SHORT = {4, 8}  # staves snapped short


def ring_arc(kit: Kit, name: str, r_out: float, r_in: float, z0: float, z1: float, a0: float, a1: float, mat: str, segs: int = 10, dent_by: float = 0.0) -> None:
    """A solid ring band from angle a0 to a1 (radians), open in the middle."""
    bm = bmesh.new()
    cols = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        c, s = math.cos(a), math.sin(a)
        cols.append([bm.verts.new((c * r, s * r, z)) for z in (z0, z1) for r in (r_out, r_in)])  # low out, low in, high out, high in
    for i in range(segs):
        p, q = cols[i], cols[i + 1]
        bm.faces.new((p[0], q[0], q[2], p[2]))
        bm.faces.new((p[1], p[3], q[3], q[1]))
        bm.faces.new((p[2], q[2], q[3], p[3]))
        bm.faces.new((p[0], p[1], q[1], q[0]))
    if a1 - a0 < math.tau - 1e-6:
        for c in (cols[0], cols[-1]):
            bm.faces.new((c[0], c[1], c[3], c[2]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, dent_by)


def core(kit: Kit) -> None:
    kit.cylinder("rod", ROD_R, ROD_H + 0.5, (0, 0, ROD_H / 2 - 0.25), "glow", vertices=10)
    # A dark socket at the rod's foot, inside the staves.
    kit.cylinder("socket", ROD_R + 0.8, 1.6, (0, 0, 0.5), "soot", vertices=10, dent_by=0.05)


def shell(kit: Kit) -> None:
    width = 2 * SHELL_R * math.tan(math.pi / STAVES) * 0.78  # leaves a crack between staves
    for k in range(STAVES):
        if k in TORN:
            continue
        a = (k + 0.5) * math.tau / STAVES
        h = (6.5 if k in SHORT else 10.5) + kit.rng.uniform(-0.8, 0.8)
        lean = math.radians(kit.rng.uniform(2, 9))
        r = SHELL_R + math.sin(lean) * h / 2
        mat = "hull" if k % 3 else "hull_grey"
        stave = kit.box(f"stave_{k}", (0.7, width, h), (math.cos(a) * r, math.sin(a) * r, h / 2 - 0.3), mat, rot=(0, lean, a), dent_by=0.1)
        taper(stave, 0.85)
        if k % 2:
            kit.box(f"stave_rust_{k}", (0.06, width * 0.5, h * 0.4), (math.cos(a) * (r + 0.38), math.sin(a) * (r + 0.38), h * 0.35), "rust", rot=(0, lean, a))
    # Bands: two whole, the middle one broken away over the torn staves.
    ring_arc(kit, "band_low", SHELL_R + 0.9, SHELL_R + 0.2, 1.0, 2.0, 0, math.tau, "hull_dark", segs=STAVES, dent_by=0.06)
    ring_arc(kit, "band_mid", SHELL_R + 1.0, SHELL_R + 0.3, 5.0, 5.8, math.radians(80), math.radians(320), "rust", segs=8, dent_by=0.08)
    ring_arc(kit, "band_top", SHELL_R + 1.1, SHELL_R + 0.4, 8.6, 9.4, math.radians(-100), math.radians(110), "hull_dark", segs=7, dent_by=0.08)
    # A crown of short torn staves leaning out round the rod's top.
    for k in range(6):
        a = k * math.tau / 6 + kit.rng.uniform(-0.2, 0.2)
        h = kit.rng.uniform(1.5, 3.0)
        kit.box(f"crown_{k}", (0.4, 1.2, h), (math.cos(a) * (ROD_R + 0.9), math.sin(a) * (ROD_R + 0.9), ROD_H + h / 2 - 0.6), "hull_grey", rot=(0, math.radians(25), a), dent_by=0.12)


def debris(kit: Kit) -> None:
    # The torn staves lie at the foot, inside the 8 m radius.
    kit.box("fallen_stave_0", (6.0, 1.6, 0.6), (4.0, 3.0, 0.3), "hull_grey", rot=(0, math.radians(-4), math.radians(-30)), dent_by=0.15)
    kit.box("fallen_stave_1", (6.0, 1.6, 0.6), (-4.6, 4.8, 0.3), "rust_dark", rot=(math.radians(5), 0, math.radians(35)), dent_by=0.15)


def build(kit: Kit) -> None:
    core(kit)
    shell(kit)
    debris(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("reactor", args, view_size=34.0)


if __name__ == "__main__":
    main()
