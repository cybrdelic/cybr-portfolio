# Combat native material reference

2026-09-23. Diagnostic only; not approved for production or integrated into the homepage.

## Reproduce

Export the active Combat workshop meshes with `window.exportCombatNative()` and save the download as `portfolio/output/combat-native-source.json`. Run `portfolio/instrument/render_combat_reference.py` using the CYBR LIGHT Python environment. Pass a new output directory label to preserve previous results.

## Evidence

- First render: `../output/combat-light-reference/reference.png`.
- Corrected render: `../output/combat-light-reference-v2/reference.png`.
- Per-run `receipt.json`, `native.json`, `materials.json`, scene, raw PFM and AOV files retain source identity, material assignments and renderer evidence.
- Actual current Combat male training mannequin and housing, exported as geometry; no robot substitution or image sprites.
- CYBR LIGHT native OptiX on the RTX 4060 Laptop GPU; 960 x 800, 128 packets, eight wavelength bands, tile 2048. OIDN applied after native rendering.

## Visual review

The first reference and its raw review were inspected individually. Its red cable was orange and the floor boundary exposed the environment. The second reference uses an explicit red reflectance spectrum and a larger floor; both defects are resolved in the inspected final image.

The corrected reference is **not photoreal approval**. Cloth lacks fiber response and texture, and the source pose has visible garment intersections at the waist and neckline. Housing faces remain overly simple and uniform. Bare metal has reflection structure but does not establish the requested machined-metal realism. The mannequin is modeled as polymer, not human skin.

## Required before production baking

1. Repair garment intersections on the actual current character without substituting a different avatar.
2. Add physically scaled garment and housing surface detail supported by the native renderer; do not silently drop browser-only textures or shaders.
3. Tune the studio reflection layout and material response on this isolated reference, then inspect both raw and denoised output.
4. Approve the reference before regenerating camera-path bakes. Existing bakes belong to the previous geometry and must not be applied to this module.

The Springs module is not covered by this reference. Its custom water shader requires a native optical implementation before an equivalent bake can be validated.

## Current integration work (supersedes the old export above)

See `CARTRIDGE-INTEGRATION-STATUS.md`. The active experimental export is
`../output/combat-native-impact-v3.json`: actual source Contact frame 3201,
source XPBD cloth replay, and a fitted frozen garment copy. The CYBR Combat
source repo/model is unchanged. This is not the old recovery-pose render.
Stepped harness/trunk connectors now close the wire gauge mismatch.
Full-assembly native bake input retains triangle UVs, measured Al/Cr optics,
rough-diffuse garments, and physical Springs vertex materials. Neither the
old reference nor the new diagnostic is final photoreal approval.
