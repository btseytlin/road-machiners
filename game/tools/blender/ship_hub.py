"""Fallen Sun hub: the junction drum of the crashed colony ship, with a broken spine stub leaving it.

Reference radius 24 m, the hub's radius. The hub is a squat twelve-sided drum 14 m tall that leans in toward
its top, ringed at the foot by torn skirt plates. On top sits a docking collar, a stepped ring 12 m in radius
and 4 m tall round a dark hole. The spine stub leaves toward +X: a flattened six-sided tube 16 m wide and 8 m tall at the
hub, narrowing to a break at x = 52, then torn plates sliding down to the sand out to x = 68, with two plate
shards standing up from it.
Run: blender --background --python tools/blender/ship_hub.py -- public/models/ship_hub.glb [tmp/ship_hub.png]
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
    "hull": 0xC4BAA6,  # PAL.hull.light
    "hull_grey": 0x8E887C,  # PAL.hull.grey
    "hull_dark": 0x6E6A62,  # PAL.hull.dark
    "rust": 0x7E5634,  # PAL.hull.rust
    "rust_side": 0x5E3420,  # PAL.rust.side
    "rust_dark": 0x3A2418,  # PAL.rust.dark
    "soot": 0x1E1A18,
}
SEED = 83

HUB_R = 24.0
HUB_H = 14.0
TOP_SCALE = 0.78  # the drum's top radius over its foot radius
SIDES = 12
COLLAR_R = 12.0
COLLAR_H = 4.0
SPINE_END = 68.0
SPINE_W = 16.0


def ring(kit: Kit, name: str, r_out: float, r_in: float, z0: float, z1: float, mat: str, sides: int = 16, dent_by: float = 0.0) -> None:
    """A hollow upright ring from z0 to z1, open in the middle."""
    bm = bmesh.new()
    layers = [[bm.verts.new((math.cos(i * math.tau / sides) * r, math.sin(i * math.tau / sides) * r, z)) for i in range(sides)] for z in (z0, z1) for r in (r_out, r_in)]
    lo_out, lo_in, hi_out, hi_in = layers
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((lo_out[i], lo_out[j], hi_out[j], hi_out[i]))
        bm.faces.new((lo_in[i], hi_in[i], hi_in[j], lo_in[j]))
        bm.faces.new((hi_out[i], hi_out[j], hi_in[j], hi_in[i]))
        bm.faces.new((lo_out[i], lo_in[i], lo_in[j], lo_out[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._add(obj, name, mat, dent_by)


def hub(kit: Kit) -> None:
    drum = kit.cylinder("drum", HUB_R, HUB_H + 1.0, (0, 0, HUB_H / 2 - 0.5), "hull", vertices=SIDES, dent_by=0.15)
    taper(drum, TOP_SCALE)
    # Darker plate bands on alternate faces, laid just outside the sloped wall.
    lean = math.atan((HUB_R - HUB_R * TOP_SCALE) / HUB_H)
    face_r = HUB_R * math.cos(math.pi / SIDES)
    for k in range(SIDES):
        if k % 3 == 1:
            continue
        a = (k + 0.5) * math.tau / SIDES
        h = kit.rng.uniform(5.0, 9.0)
        z = kit.rng.uniform(h / 2 + 1.0, HUB_H - h / 2 - 0.5)
        r = face_r * (1 - (1 - TOP_SCALE) * z / HUB_H) + 0.25
        w = 2 * face_r * math.tan(math.pi / SIDES) * kit.rng.uniform(0.4, 0.8)
        mat = kit.rng.choice(["hull_grey", "hull_grey", "rust", "rust_side", "hull_dark"])
        kit.box(f"wall_plate_{k}", (0.3, w, h), (math.cos(a) * r, math.sin(a) * r, z), mat, rot=(0, lean, a), dent_by=0.1)
    # Torn rim plates sticking up round the top edge.
    top_r = HUB_R * TOP_SCALE
    for k in range(7):
        a = kit.rng.uniform(0, math.tau)
        if abs(math.cos(a)) > 0.85 and math.cos(a) > 0:
            continue  # leave the spine's root clear
        h = kit.rng.uniform(2.0, 5.0)
        r = top_r - 0.8
        tilt = math.radians(kit.rng.uniform(-25, 15))
        kit.box(f"rim_{k}", (0.4, kit.rng.uniform(3, 7), h), (math.cos(a) * r, math.sin(a) * r, HUB_H + h / 2 - 0.5), kit.rng.choice(["hull_grey", "rust_side", "hull"]), rot=(0, tilt, a), dent_by=0.2)
    # Skirt of angular plates leaning on the foot of the drum.
    for k in range(8):
        a = (k + kit.rng.uniform(-0.2, 0.2)) * math.tau / 8
        if math.cos(a) > 0.8:
            continue
        h = kit.rng.uniform(4.0, 8.0)
        r = HUB_R - 0.3
        kit.box(f"skirt_{k}", (0.5, kit.rng.uniform(5, 9), h), (math.cos(a) * r, math.sin(a) * r, h / 2 - 0.6), kit.rng.choice(["hull_dark", "hull_grey", "rust_dark"]), rot=(0, math.radians(kit.rng.uniform(-30, -15)), a), dent_by=0.25)


def collar(kit: Kit) -> None:
    # Stepped docking ring round a dark hole.
    ring(kit, "collar_outer", COLLAR_R, COLLAR_R - 2.4, HUB_H - 0.5, HUB_H + COLLAR_H - 1.0, "hull_grey", dent_by=0.1)
    ring(kit, "collar_lip", COLLAR_R - 2.4, COLLAR_R - 4.0, HUB_H - 0.5, HUB_H + COLLAR_H, "hull", dent_by=0.08)
    ring(kit, "collar_band", COLLAR_R + 0.3, COLLAR_R - 0.3, HUB_H + 0.6, HUB_H + 1.4, "rust", dent_by=0.05)
    kit.cylinder("hole", COLLAR_R - 4.0, 0.3, (0, 0, HUB_H + 0.3), "soot", vertices=16)
    # A broken piece of the lip lying on the hub top.
    kit.box("lip_piece", (4.0, 1.4, 2.0), (COLLAR_R + 2.0, -5.0, HUB_H + 0.6), "hull", rot=(math.radians(20), math.radians(-10), math.radians(-30)), dent_by=0.15)


def spine(kit: Kit) -> None:
    # The intact root: a flattened six-sided tube, 16 m wide and 8 m tall at the hub, narrowing to the break.
    x0, x1 = HUB_R * TOP_SCALE - 2.0, 52.0
    root = kit.cylinder("spine_root", SPINE_W / 2 / math.cos(math.pi / 6), x1 - x0, ((x0 + x1) / 2, 0, 2.4), "hull", rot=(0, math.radians(90), 0), vertices=6, dent_by=0.15)
    for v in root.data.vertices:
        v.co.x *= 0.62  # local x is height once the tube lies along X
    taper(root, 0.8)
    kit.box("spine_top", (x1 - x0 - 6, 5.0, 0.8), ((x0 + x1) / 2 - 1, 0, 7.3), "hull_grey", rot=(0, math.radians(1.6), 0), dent_by=0.1)
    # Dark window rows and rust down the -Y side, rust on the top.
    for i in range(7):
        x = 24 + i * 3.2
        kit.box(f"window_{i}", (1.8, 0.4, 1.4), (x, -SPINE_W / 2 * (1 - 0.2 * (x - x0) / (x1 - x0)), 2.4), "soot")
    kit.box("side_rust", (8.0, 0.2, 2.5), (36, -6.9, 5.4), "rust", rot=(math.radians(-50), 0, 0), dent_by=0.1)
    kit.box("top_rust", (6.0, 4.0, 0.15), (30, 1.5, 7.8), "rust", rot=(0, math.radians(1.6), 0), dent_by=0.08)
    # Past the break: angular plates sliding down to the sand, each smaller and lower.
    plates = (
        (54, 0.0, 9.0, 12.0, 3.4, -14, 6),
        (60, -2.0, 7.0, 10.0, 1.8, -10, -10),
        (65, 1.5, 6.0, 8.0, 0.9, -6, 14),
    )
    for i, (x, y, length, width, z, pitch, yaw) in enumerate(plates):
        mat = kit.rng.choice(["hull", "hull_grey", "rust_side"])
        kit.box(f"spine_plate_{i}", (length, width, 0.6), (x, y, z), mat, rot=(math.radians(kit.rng.uniform(-8, 8)), math.radians(pitch), math.radians(yaw)), dent_by=0.3)
    # A few loose stringers poking out of the break.
    for i, y in enumerate((-5.0, 0.5, 5.5)):
        kit.box(f"stringer_{i}", (12.0, 0.6, 0.6), (54, y, 5.0 - i), "hull_dark", rot=(0, math.radians(14 + 4 * i), math.radians(kit.rng.uniform(-6, 6))), dent_by=0.1)
    # Two plate shards stand up from the stub.
    kit.box("shard_0", (1.0, 6.0, 13.0), (56, -7.0, 5.0), "hull_grey", rot=(math.radians(-14), math.radians(10), math.radians(20)), dent_by=0.4)
    shard = kit.box("shard_1", (0.8, 4.5, 10.0), (38, 8.5, 9.0), "rust_side", rot=(math.radians(12), math.radians(-8), math.radians(-10)), dent_by=0.4)
    taper(shard, 0.3)


def build(kit: Kit) -> None:
    hub(kit)
    collar(kit)
    spine(kit)


def main() -> None:
    args = parse_args()
    kit = Kit(COLORS, SEED)
    build(kit)
    kit.export("ship_hub", args, view_size=110.0)


if __name__ == "__main__":
    main()
