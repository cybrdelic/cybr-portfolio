# Persistent instrument — surface-material rebuild, 22 September 2026

Latest update: see `ASSEMBLY-OPTICS-DELIVERY.md` for the revised mechanical assembly, constant-length cable, captured workshop illumination and local mesh-intersection optics. It supersedes the screen-space transmission and provisional camera descriptions below. `FLIP-DELIVERY.md` records the preceding fluid pass. Older measurements below are historical, not current performance claims.

## Current material pass (supersedes the initial prototype below)

The live 3D renderer no longer loads the six front-view beauty WebPs. Those files remain on disk but are not runtime material dependencies. HTML images are only the loading/context-loss fallback and navigation thumbnails.

Kept changes:

- Original CAD normals and all 1,728,428 triangles retained. No simplification or nearest-vertex normal transfer. UV seams split without welding face normals.
- Reused CYBR Light's per-corner machining UV charts; authored low-amplitude roughness texture in surface coordinates. Removed the noisy bump experiment.
- Analytic shaft-relative anisotropy directions avoid triangle-dependent machining highlights.
- Offline 32-ray cosine-weighted hemisphere visibility per vertex, against opaque geometry within each module, maximum distance 24 mm. This is local occlusion, not full global illumination or inter-module shadows.
- Corrected the 180-degree longitude convention difference between CYBR Light and Three's environment mapping.
- Version-keyed mesh/roughness requests and decoded-length validation prevent old binary/new manifest combinations.

Verification: `verify_web3d.py` checks every packed attribute and index, unit normals, finite UVs, AO ranges, absence of projected-beauty dependencies and 8,374 planar GEO triangles: **zero corrupted planar normals**. Node syntax check passes. Final six-second browser scroll sample: median interval 6.1 ms, p95 6.3 ms, zero intervals over 33.4 ms, zero page exceptions, zero idle draws, no horizontal overflow at 390×844. This is one local browser sample, not a GPU benchmark or physical-phone guarantee.

Payload tradeoff: 15,269,392 compressed mesh bytes / 64,649,000 decoded bytes, 30 mesh groups (71 calls including transmission and cables). Full normals/detail are prioritized over the earlier unsafe reduction.

Visual evidence on the build drive: `D:/CYBR-build/exploded-instrument/output/playwright/3d/material-plate-final.jpg`, `material-metal.jpg`, `material-mobile-final.jpg`. Compare the retained `align-final.jpg` baseline: its triangular metal highlights are removed. The original hero HTML/CSS/JS hashes are unchanged.

**Still not photoreal parity:** nested glass/water transmission remains visibly softer and simpler than the spectral reference, with no equivalent multi-interface spectral transport. The opening's lens color/refraction no longer matches the old painted beauty. The provisional camera route still has intrusive close-ups and is not a certified through-centre path. Three bounded material-review rounds completed; do not promote this as a finished replacement or claim all-angle beauty equivalence.

Rebuild uses the existing build Python environment with NumPy, scipy, trimesh, embreex and Pillow. Run `export_web3d.py --folder D:/CYBR-build/exploded-instrument`, then `verify_web3d.py`. No image-generation assets were used.

## Historical initial prototype — superseded

Preview: `/portfolio/instrument-3d.html`. **Not promoted** to the original page.

## Implemented

- Six persistent CYBR GEO mesh groups, not sprite planes. All 1,289 named source parts retained; boundary-preserving simplification delivers 1,354,640 triangles in 30 material/feature batches. Compressed mesh: 9,342,551 bytes; decoded: 38,866,644 bytes.
- Existing CYBR Light v9 front-camera spectral images projected onto the actual surfaces. This preserves most of the opening appearance, not arbitrary-angle spectral accuracy.
- Condensation, camera rotation, provisional curved inspection route, continuous scroll smoothing and reverse travel. Four attached 3D cable spans.
- Themed social slot, currently GitHub cybrdelic and local Projects. Additional social URLs require confirmation.
- Render-on-demand, capped pixel ratio, no live path tracing or shadow maps. HDR studio prefilter runs once at initialization; moving reflections and transmission remain real-time approximations.

## Verification

Compared `D:/CYBR-build/exploded-instrument/output/playwright/metal-after-plate.jpg` against `output/playwright/3d/plate-final.jpg` on the same build drive. Opening geometry matches closely; cable placement/shading differs. Initial mesh reduction damaged CAD borders; preserving borders corrected the visible holes. Tightened camera depth range also avoids excessive depth quantization.

Final desktop six-second scroll sample, 1586×992: animation-frame interval median 12 ms, p95 18.2 ms, one interval over 33.4 ms. These are browser frame intervals on this machine, **not GPU timings or a cross-device performance guarantee**. Zero render calls during 900 ms settled idle. No page exceptions; no horizontal overflow at 390×844. Mobile social positioning was subsequently adjusted to avoid the LIGHT label.

Original HTML/CSS/JS SHA256 hashes still match the pre-change baseline. Final mobile check confirms no social/LIGHT overlap; reduced-motion page stays one viewport tall. Simulated context loss removes the canvas and restores the static plate without the long scroll region.

## Not finished / decision needed

The optical backing, narrow SONG bore and solid SCENES core prevent the requested straight through-centre journey. Current path curves around them and is not a collision-certified route. Decide whether internals may open/reconfigure after condensation, or geometry must remain fixed.

Rotated metal/glass quality is visibly below the spectral opening. Full surface bakes, view-dependent material refinement, interior-route clearance, wire-length behavior and wider device testing remain necessary. Do not describe this prototype as fully baked, pixel-identical, physically simulated, or production-ready.
