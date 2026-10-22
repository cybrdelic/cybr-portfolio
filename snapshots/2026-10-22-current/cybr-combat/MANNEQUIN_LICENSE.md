# CYBR anatomical mannequin — asset provenance

The active `assets/cybr_mannequin.glb` is a derivative of the MakeHuman CC0
anatomical base mesh and painted skin weights, converted to a 52-joint rig using
Quaternius CC0 rest-frame references. It is not claimed as a wholly original
sculpt. CYBR's mesh refinement and rebind contributions are also dedicated to
CC0 1.0. Commercial use, modification and redistribution of this graphical asset
are permitted under those asset terms, without a purchase or attribution requirement.
Credits are retained voluntarily.

Sources:

- https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md
- https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md
- https://static.makehumancommunity.org/about/license.html
- https://quaternius.com/packs/universalanimationlibrary.html
- https://creativecommons.org/publicdomain/zero/1.0/

Exact downloaded graphical sources and their licenses are retained in
`assets/mannequin-source/`. SHA-256 records are in `evidence/mannequin_mesh.json`.
MakeHuman's application code is separately AGPL; no MakeHuman application code
is used or included in this builder. Its base mesh, rig and weight data are CC0.

The active stage is generated from an original plane and numeric materials;
there are no external textures, armor or helmet meshes. The editable `.blend`
contains the new skinned mannequin, not the old soldier.

The male variant (`cybr_mannequin_male.glb` / `.blend`) uses the official
MakeHuman young-adult male macro targets and athletic body target from
`makehuman/data/targets/macrodetails/` in that same repository. Each retained
target explicitly carries a CC0 header. Both variants have separate CYBR-shaped
shirt and shorts meshes derived from that topology, with their own vertex and
skin-weight buffers, real openings and thick edges. They share the playback bind.
The exported kit is skinned. The viewer additionally has an optional original
experimental cloth solver; it adds no third-party assets or model weights.
Male source hashes are in `mannequin_male_mesh.json`.

This does not relicense old screenshots, videos, archived soldier assets or Git
history. A repository-wide public release still needs to exclude or clear those
historical materials. The standalone new GLB and its source asset package do not
depend on those restricted assets.
