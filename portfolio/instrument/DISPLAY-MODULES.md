# Combat and Desert Hot Springs cartridges

## Current Combat replacement — mannequin16

The live workshop now loads `combat-impact-cloth-v1.json` / `combat-impact-cloth-v1.bin.gz`,
not the old armored `combat` package described below. Rebuild with
`python portfolio/instrument/export_current_combat.py`. Source is the current
`cybr-combat/preview` export, male training-kit variant selected by default
in `cybr-combat/src/inspector.html`, derived from `cybr_mannequin_male.glb`.
The receipt records model and geometry hashes. The rig's frame 3210 from
`Original / step-in cross` is frozen into 140,498 source triangles, retaining
body, shirt, shorts and their source material colors. No old textures, helmet,
armor or invented sword are loaded. Rig source is retained; this display
package is a static pose, not live animation or a completed optical bake.

Verified `output/playwright/combat-current-male16.jpg`: correct mannequin,
no page errors, 166,304 submitted triangles / 65 calls including chassis.
The selected pose exposes shirt/waist and shoulder garment artifacts; these
remain visible and need source-pose/garment review before production baking.
Four old Soldier model exports are preserved privately and omitted from the
public source package; they are not loaded by the workshop. See
[publication boundary](../../docs/PUBLICATION.md).

## Historical first export (superseded)

Preview: `/portfolio/module-workshop.html` (or `?module=springs`).

These are real mesh assemblies, independently viewable with orbit, zoom,
assembly separation and wireframe. They are not replacement production bakes.
The existing homepage and its 49-view bake package are unchanged.

## Source and construction

- `build_display_modules.py` exports the retained Combat physical-animation proof,
  frame 23. Skin transforms are baked into vertex positions. Original bronze
  armor and helmet maps are retained. The original axe is replaced with a new
  sword attached to the original weapon matrix. The pose is static, not a new
  combat simulation. Character assets retain the source project's third-party terms.
- Desert Hot Springs reuses v11 `height`, `poolq`, `rock_template`,
  `landscape_ridges`, and `connected_shrub`. Foreground terrain is cropped to
  a 14 m diameter disk. Distant mountains are compressed and filtered for a
  diorama; this is not a uniformly scaled export of the entire environment.
- The workshop builds beveled mounting rings, fasteners, support spokes,
  connectors, a tray and a continuous cable below the tray as actual meshes.
- Rendering is Three.js PBR, using the existing instrument's studio environment.
  This is not CYBR LIGHT path-traced output and is not claimed to match the
  generated concept's photographic appearance. No generated image is used on
  any surface and no sprites are used.

## Deliverables

Historical `cybr-combat-cartridge.glb`: 88 meshes, 104,374 triangles; retained privately, not bundled publicly.
`assets/display-modules/cybr-springs-cartridge.glb`: 85 meshes, 637,229 triangles.

Both GLBs include the hardware and cable, geometry, UVs and embedded PBR maps.
Water uses glTF transmission, IOR and volume extensions. The workshop's small
procedural cable-weave and cutaway-strata shader additions are not baked into
the GLBs. The water surface is a static shoreline-conforming mesh, not FLIP.

Historical reconstruction requires the omitted private physical-animation-proof
inputs and original workspace/environment; it is not the public installation path.
The retained historical command is:
`python portfolio/instrument/build_display_modules.py`.
Export the visible assembly with `window.moduleWorkshop.exportGLB()` in the
workshop. It downloads one GLB without sending bulk geometry through tool output.

## Validation and remaining work

- Independent trimesh import verified both GLBs, all vertex coordinates finite.
- Export metadata saved in `assets/display-modules/export-verification.json`.
- Desktop 1440x1000 and mobile 390x844 screenshots inspected; no mobile overflow.
- Short warmed-up terrain orbit probe: callback interval p50 6 ms, p95 13.4 ms;
  not a hardware GPU timing or universal frame-rate claim. Zero idle draws in 1 s.
- Rendering initially failed once due to a transient local-server fetch error;
  reload succeeded and final preview error text was empty.
- Remaining: final spectral lighting/material work, closed optical water volume,
  performance LODs, collision/clearance audit across assembly states, new
  camera-path bakes, and homepage integration. Current OptiX production renderer
  explicitly rejects textured materials; do not silently discard these maps or
  apply old bakes to this changed geometry.

Visual-validation loop caught and corrected the initial basin/tray intersection,
inward cutaway wall normals, avatar orientation and axe/sword mismatch.
