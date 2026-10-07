# Assembly and optical reconstruction — 22 September 2026

Preview: `/portfolio/instrument-3d.html?revision=11`. This remains a development preview, not photographic parity with CYBR GEO or the image-generation reference. The original instrument-preview landing page was not replaced.

## Changes retained

- Six genuine CAD-derived mesh assemblies, 1,274 source parts, 1,738,028 triangles, 38 packed groups. No projected beauty images in the live materials. Loading/context-loss images and thumbnails remain intentionally static.
- Bored passages through LIGHT and SCENES; curved ELEMENTS glands follow its internal cable. Extended COMBAT lead. GEO has an internal take-up loop; five external spans join the six modules continuously.
- GEO floating interface/fasteners and LIGHT mounting rings/screws move into seated positions during condensation. Added matching holes/lugs; removed four conflicting GEO flange bolts and their surrounding hardware. Moving trim is excluded from the static optical BVH to prevent phantom exploded-position reflections.
- Constant total cable length through condensation. This is geometric length conservation, not an elastic-rod simulation or manufacturing-qualified cable design.
- CYBR GEO V9's captured Poly Haven small_workshop HDR (CC0), prefiltered lighting for opaque materials, authored roughness and per-part finish variation, original CAD normals and local baked occlusion.
- Actual local mesh intersection/refraction through glass and baked fluid states. Offline GPU BVH caches stream on demand; three fluid optical states retained. Up to twelve dielectric interfaces, total internal reflection, water absorption and one reflected opaque hit. LIGHT also has an approximate three-band thin-film coating. This is not a full spectral/global path tracer.
- Wall-conforming reconstruction of the recorded 436,708-particle, 1.25 mm-grid FLIP simulation. Preserves original free-surface motion and volume, rather than inventing animated waves. Original solver is unchanged. All 72 unique states validated; quantized surface volume error at most 0.5581%; reported solver solid violations zero and all pressure steps converged.
- Camera stays outside the narrow working bores while following the cable. Corrected condensed framing so SCENES stays on screen; corrected entry to inspect GEO obliquely instead of filling the view with its rear plate. The route is deliberately not a literal camera travelling through sub-millimetre cable clearance.
- Fixed-size rendering targets during layout transitions, render-on-demand, moving/settled sampling, mobile layout, reduced-motion and static context-loss fallback.

## Verification

`test_models.py`: nine passing shape/mesh checks. `verify_web3d.py`: finite attributes, valid indices, unit normals, zero corrupted normals on 8,374 planar GEO triangles, zero projected-beauty dependencies. `verify_raydata.py`: hashes, sizes and finite textures for two static modules and 72 fluid states, 78,528,787 compressed bytes. Main compressed geometry: 15,470,850 bytes.

`check_routing.mjs`: 21 condensation states, maximum cable-length error 7.36e-8 mm; nonlocal take-up separation at least 12.51 mm for a 4.7 mm cable. Minimum sampled bend radius 5.73 mm: not a durability certification. `check_clearance.py`: five assembly states, sampled radial rays and per-part solid-containment checks, no reported penetration. This does not prove unsampled states or all mechanical contacts are collision-free.

`check_optical_orientation.py`: both glass meshes have zero reversed/degenerate triangles. Three sampled quantized fluid states have 11–20 degenerate triangles and up to two tiny reversed triangles; record this limitation rather than calling the cache flawless.

Browser artifacts: `D:/CYBR-build/exploded-instrument/output/playwright/3d/v4-{hero,assembled,optic,route,exit,fluid}.jpg`, `final-hero.jpg`, `mobile-final.jpg`. The fluid image isolates ELEMENTS; other assemblies are hidden, so exposed ends of external cable spans in that diagnostic are expected.

Final post-revert camera-path timing sample: 12-second forward / six-second reverse, p95 frame interval 36.6 / 42.7 ms; 60 / 35 intervals over 33.4 ms. An earlier sample of this same retained shader/camera measured 24.3 ms in both directions, so timing is variable and the final result does not establish smooth 60 fps. Zero page/console errors and zero draws during one second of settled idle. These are local browser RAF intervals, not GPU timings or a device-independent frame-rate guarantee.

A geometric-normal grazing-ray offset experiment showed no convincing visual gain and measured p95 42.3 / 48.7 ms. It was reverted, not retained as a claimed fix. Use `probe_final_motion.js` to repeat the measurement on the target device.

Mobile 390×844: no horizontal overflow or social-card/LIGHT-label overlap. Reduced-motion layout is one viewport tall. Simulated context loss removes the canvas and restores the static plate. These checks use an isolated QA browser, not the user's tab.

## Remaining visual limits

Glass/water highlights remain busy, and the lens is much less colorful than the original concept. The mineral core is still visibly faceted; lighting/material realism is below the native references. Local ray optics omit other modules, moving trim, full reflected dielectric paths and caustics. Opaque lighting lacks inter-module/global illumination. Tiny reconstructed fluid degeneracies remain. Native and browser renders are not equivalent.

The optical sequence is about 78.5 MB in total, streamed rather than all loaded upfront; it is not a small download. The separate mesh-fluid sequence is retained for diagnostics/fallback; the default ray-optics path does not stream those hidden mesh frames.

A development native comparison is at `D:/CYBR-build/exploded-instrument/reference-v4/instrument.png`: Mitsuba scalar RGB, 256 samples, 16 bounces, captured HDR and OIDN. It is still noisy and predates removal of the last redundant GEO bolts. It is not an approved final reference, and is not substituted for interactive 3D. LLVM and OptiX backends failed on this environment, so the comparison ran on CPU.

New browser dependency: vendored three-mesh-bvh 0.9.5, with its license in `portfolio/vendor/three-mesh-bvh-0.9.5/`. Offline bake dependencies live in the existing D-drive build environment. No AI image-generation assets were introduced in this pass.
