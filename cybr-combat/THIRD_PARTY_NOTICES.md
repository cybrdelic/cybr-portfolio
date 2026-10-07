# Historical Combat provenance and third-party visual assets

This retained notice describes the older armored revision and its source
lineage. The current public Inspector uses the MakeHuman/Quaternius mannequin,
not the historical Soldier. See [current motion and graphical credits](MOTION_LICENSES.md)
and [exact publication boundary](../docs/COMBAT_ASSET_SCOPE.md).
Old model exports remain in private snapshots; rendered evidence is retained.

## Animation in this revision

The four preserved baseline takes are authored in `src/performance.py`.
Two additional grounded studies are authored in `src/authored_v2.py`, without
sampling imported poses. Three reference performances are retargeted from
Quaternius Universal Animation Library 1 and 2, Standard editions, CC0-1.0.
These are authored game animations, not claimed to be captured human motion.
The character GLB remains bind-only; reference tracks live separately under
`assets/motion-sources`. The export joins source-labeled takes into the library.

Author and license: https://quaternius.com/packs/universalanimationlibrary.html
and https://quaternius.com/packs/universalanimationlibrary2.html.
Transport mirrors (free Standard files only):
- J-Ponzo/gltf-universal-animation-library, revision
  `e24c23cf2a1323488a3faa226ea7ea21f644b73e`, `glTF/`.
- Barbatos6669/elderforge, revision
  `bb2ce469f0ab2ccfc487faef55550ba07fae2483`,
  `assets/animations/universal_animation_library_2/UAL2_Standard_RM.glb`.

The source files and Quaternius license notice are retained locally for
reproducibility. No paid collection or restricted source file was obtained.

V4 additionally uses the bundled collections for motion-assisted player attacks
and enemy reactions: sword regular A/B/C, sword idle, crouch idle, punch enter,
punch cross, chest/head hits, death, knockback and get-up. These professional pose
foundations remain credited to Quaternius; CYBR authors the combat assembly,
timing, contact corrections, launch/juggle trajectories and state logic. The six
V4 encounters are not represented as wholly original hand-keyed performances.

## Retained character body and rig

The body/rig and body texture data originate from the Mixamo Vanguard model
provided as `Soldier.glb` in the official Three.js skinning example. These are
retained visual assets, not an original CYBR sculpt and not assigned this
project's software license. `assets/character_bind_only.glb` contains the
animation-stripped visual input for this private project delivery. Packed
viewer buffers also contain the previously developed body/skin geometry.
This delivery does not assert an unrestricted redistribution license for the
third-party character or replace the original asset's terms.

## Helmet

The separate SciFiHelmet is by Michael Pavlovic, with glTF conversion by
Norbert Nopper. The previously supplied Khronos sample attribution identifies
it as CC0. Its geometry and maps are retained in the renderer's visual buffers
and attached to the animated head. The helmet and textures are not an original
CYBR sculpt or newly generated imagery.

## Ground surface

The floor retains Poly Haven `rock_boulder_dry` material maps and the existing
displaced geometry. The previously supplied source metadata identifies the
maps as CC0. `visual_asset_sources.json` preserves the original URLs and hashes
from the earlier mesh-development package.

## Rendering and runtime

The WebGL2 PBR shader, glTF skin evaluation and review tools build on the
previously supplied CYBR source. The existing GPL-2.0 software notice is
retained. No new video frame was produced by CYBR LIGHT spectral path tracing;
this delivery is the rasterized motion-review route. No Blender, image model,
video-generation model or denoising model runs in this pipeline.

Visual-asset provenance is distinct from motion provenance. Original animation
does not imply that the underlying third-party models or textures are original.
