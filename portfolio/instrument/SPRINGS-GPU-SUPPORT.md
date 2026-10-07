# CYBR LIGHT GPU: Springs compatibility work

2026-09-23. Experimental; not a declaration that the complete Springs scene or hero bake is ready.

## Implemented and tested

- GPU linear PFM colour maps, bilinear filtering, UV scaling, negative repeat and clamp.
- One tangent normal-map or finite-difference bump-map wrapper on supported materials, including dielectric water. Wrapper parameters are preserved instead of silently discarded.
- Quad UVs survive triangulation; normal/albedo AOVs include mapped detail.
- High-resolution environment samples are integrated within the lighting proposal cells. This addresses small HDR solar lights being missed by a single sample.
- Checkpoints identify the host executable as well as scene dependencies and PTX, including changed texture assets.

Candidate: `../output/optix-springs-dev-v3/cybr-light-optix.exe`. The installed production executable on D: is unchanged.

Validation artifacts:

- `../output/optix-maps-validation-v3/result.json`: 100% ID agreement, mean-film error 0.001081%, zero invalid paths; exact resume and texture-change rejection passed. CPU/GPU comparison image inspected.
- `../output/optix-springs-regression-v3/validation.json`: existing metal/glass fixture passed, 100% IDs, mean-film error 0.008366%; exact resume and invalid-checkpoint/unsupported-feature rejection passed.
- These small fixtures are correctness evidence, **not measured speedups**. GPU total wall time was longer than CPU on these tiny fixtures.

## Source-material export

`export_springs_materials.cpp` invokes the actual source `shade()` implementation at the existing source-coordinate probes. It outputs 2,309,944 samples of albedo, normal, roughness and IOR, without lighting. It does not treat the workshop's already-lit vertex colours as reflectance. The optional environment export retains source sky and integrated solar-disc energy. This adapter inherits the source GPL-2.0-only license.

`render_springs_gpu_probe.py` tests the original mineral shelf and closed pool (244,999 triangles) using those physical maps, achromatic IOR 1.334 and source wavelength-dependent water absorption corrected for miniature scale. This is deliberately not the entire fused cartridge. Test 1 exposed missing sunlight; test 2 exposed the coarse environment sampler missing the small sun. Both are retained for evidence rather than presented as successful visual parity.

## Still required before hero baking

- Map the physical samples onto the current fused ridge/terrain and other module meshes; the focused test only covers the original pool shelf.
- Preserve spatial roughness and the source rough-diffuse BRDF, instead of the test's median-roughness plastic approximation.
- Implement and validate source water scattering and required caustic/steam transport. Current dielectric absorption/refraction is not all of the original water model.
- Validate water closure, UV/normal behaviour, lighting and source appearance on the complete cartridge; inspect full-quality views.
- Rebuild the hero geometry, camera-path optical bakes and depth/ID data as one matching asset revision. Never reuse old module bakes with replacement geometry.

The homepage and its existing production bakes have not been replaced.

## Subsequent native support and assembly fixes

Implemented in isolated `optix-water-nee-v7` (production binary is unchanged):

- Source-style Oren–Nayar/GGX landscape shading, spatial roughness, and mapped IOR.
- Per-triangle barycentric albedo/roughness/IOR, exported with `surface_material`.
  These are unlit physical parameters, not the previous workshop radiance colors.
- Homogeneous dielectric scattering with HG phase and wavelength-dependent absorption.
- Opt-in `--refractive-nee`: numerical single-interface Snell connections with
  a Jacobian and complementary continuation MIS. This is single-root transport,
  not a claim of general multi-interface caustics or steam support.
- Higher-resolution environment proposals retaining the small solar disc.

Evidence inspected individually:

- `../output/water-nee-validation/comparison.png`: submerged receiver, 0.0386%
  relative mean difference against ordinary GPU continuation, no invalid samples.
- `../output/water-scattering-validation/comparison.png`: scattering water,
  0.0165% relative mean difference against ordinary continuation, no invalid samples.
- `../output/landscape-validation/comparison.png`: CPU/GPU roughness-map fixture,
  0.0113% relative mean difference, exact resume and texture-change rejection.
- `../output/vertex-material-validation-v7/comparison.png`: CPU/GPU direct
  vertex-material fixture, 0.0123% mean difference, 100% object IDs, zero invalid
  samples, exact resume and changed-texture checkpoint rejection. This does not
  independently validate the optional IOR texture, since the tested receiver uses
  vertex attributes. No speedup claim: GPU wall time exceeds CPU for this tiny test.

`build_springs_physical.py` now exports the full fused 2,455,195-triangle interior.
`export_springs_native.py` streams the scene rather than keeping millions of Python
triangle dictionaries. Heavy scene inputs live on D:, not the nearly-full C: drive.
The scene packages contain source hashes and explicit unapproved status.

Actual geometric defects repaired in the workshop and native inputs:

- Mineral sidewall extended from -0.07 to -0.83 to contain the water bottom at -0.80.
- Carrier lowered by 0.775 so it no longer cuts through the pool; cable moved below it.
- Ring bevel radius limited by radial width and depth, preventing folded profiles.
- Cylindrical sidewall normals replace staircase-boundary stripes.

`../../output/playwright/springs-fit-v3.png` was inspected: ring speckling and
sidewall striping are visibly reduced. This browser image still uses the old
preview water/shading and is NOT evidence of the final native bake.

The original Springs camera uses exposure 1.9 and a hue-preserving exponential
shoulder, unlike the portfolio studio's ACES/exposure 0.55. `display_springs`
preserves that source grade while using CYBR LIGHT's neutral-film calibration.
Both grades of the raw pool diagnostic are retained. It remains noisy and is
not a production asset. Full cartridge, Combat material repair, source-specific
steam, final hero lighting, matching geometry/depth/ID bakes and integration remain.

## Final focused-test review

`../output/springs-gpu-material-probe-v3/raw-review.png` was inspected directly.
The corrected environment proposal restores direct illumination on the shelf,
unlike tests 1 and 2, but the 32-packet raw image is noisy and the pool remains
too dark. This is a rejected visual-parity result, not an accepted production
asset. In particular, unimplemented underwater solar connections/scattering
cannot be substituted with a higher sample count or a denoiser. The test did
complete on the physical GPU with zero invalid paths. No production queue was
launched and all prior renders were preserved.

## Current staged hero integration

The later v8 renderer includes vertex-material albedo in AOVs and `--aov-only`
for correcting guides without modifying raw films/checkpoints. GPU/CPU AOV
maximum normal error was 1.43e-6, albedo error 2.95e-6, with exact object IDs.
The corrected low-resolution full-cartridge guide review is still too soft
for production approval; numerical agreement is not visual parity.

The carrier and support feet now clear the closed pool; the cable runs outside
the mineral wall, above the lowered carrier, through explicit stepped junctions.
Current exports, SHA identities, tests and pending gates are recorded in
`CARTRIDGE-INTEGRATION-STATUS.md`. The previous source-daylight limitations and
low-resolution rejection must not be mistaken for final hero bake completion.
