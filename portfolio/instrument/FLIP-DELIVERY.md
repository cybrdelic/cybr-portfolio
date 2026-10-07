# Baked vessel FLIP and ring sampling — 22 September 2026

## Higher-resolution revision (current; supersedes numbers below)

- Actual solver grid changed from 2.5 to 1.25 mm (48×52×48). 436,708 particles instead of 53,819; reconstruction spacing 0.85 mm instead of 1.7 mm. Approximately 44–45k triangles/state instead of 11k. This is a rebake, not subdivision of the old surfaces.
- All 72 distinct states validated: hashes, packed lengths, normal lengths, bounds, converged pressure, no reported solid violations. Maximum reconstructed volume error 0.5573%. Complete compressed sequence 37,509,804 bytes, streamed with the same eight-frame cache.
- Reduced liquid roughness from .035 to .008. Screen-space glass/water transport remains approximate: close-ups still contain distorted/repeated cable reflections and faceted glass. Increased simulation resolution does **not** fix these or establish photorealism.
- Ring finish contrast is integrated more conservatively toward its mean; thin geometry receives increased sampling (1.25× during transitions, 2× settled desktop / 1.5× settled mobile). No CAD geometry was removed. Fixed-height backing targets avoid reallocating HDR/MSAA buffers on every scroll step. A/B-only `samples` query permits fixed 1×/2× tests.
- Final six-second desktop sample: 520 animation frames, median 12.1 ms, p95 24.1 ms, six intervals over 33.4 ms. Zero settled idle draws, zero page exceptions, no 390×844 horizontal overflow. This is higher cost than the low-resolution cache, not a universal performance guarantee.
- Actual browser evidence: `D:/CYBR-build/exploded-instrument/output/playwright/3d/hires-{plate,ring}-{1,2}.jpg`, `hires-detail-{0,24,71}.jpg`, `hires-mobile.jpg`. Earlier `fluid-*` files are the baseline. Ring interference is reduced in tested views; no claim that every pose is alias-free.
- Build: `node portfolio/instrument/bake_flip.mjs D:/CYBR-build/exploded-instrument/fluid-v3-hires`; validate with `verify_flip.py <directory>` before publishing contents to `assets/instrument-fluid`.

### Photographic quality gap

CYBR GEO's approved V9 uses captured workshop HDR illumination, multi-bounce Mitsuba transport and a thin lens (`cybr-geo/docs/RENDER_V9.md`). Observatory IV uses native spectral transport, anisotropic material evaluation and refraction-aware reconstruction (`cybr-scenes/scenes/observatory-iv/README.md`). This browser preview instead uses studio environment reflections, per-vertex AO and screen-space layered transmission. Those are not equivalent pipelines. A denser liquid cache and edge filtering do not resolve the missing glass transport, photographic lighting, or material/geometry fidelity. The user's photographic-quality target remains unmet; a same-geometry native reference and a separately validated interactive transport solution are still needed. A single view's beauty texture must not be substituted as a supposed view-independent bake.

## Previous revision record

## Delivered

`instrument-3d.html` loads real liquid surface meshes baked from the existing CYBR FLIP III solver in `cybr-elements/work/flip-lettering/vendor/src/flip.js`. The solver files were not modified. `bake_flip.mjs` is a scene/collision adapter and surface-cache exporter.

- 53,819 primary particles, quadratic APIC/FLIP transfer and Galerkin MG-PCG pressure projection.
- 2.5 mm grid; rounded 53×55×59 mm cavity and curved cable exclusion; gravity and an initial lateral impulse. The vessel is fixed in simulation coordinates.
- 72 distinct surface states cover 0.4 seconds of simulation. Scroll scrubs the recorded states. Reverse scroll reverses playback, not physical time integration. It is not a continuously running or seamless looping solver.
- Reconstructed with the existing isotropic, volume-calibrated surface builder. No procedural wave/height animation or sprite substitution.
- Packed positions use 1/512 mm steps and signed-normal quantization. The complete sequence is 9,126,665 bytes compressed; the client fetches individual frames and retains at most eight decoded frames with one GPU mesh buffer.
- Old static water mesh is hidden only after the FLIP frame loads successfully.

## Water visibility

The vessel previously refracted an opaque-only scene buffer that did not contain its liquid. A half-float layered prepass now renders the actual water state without the outer glass, then supplies that result to the outer shell's transmission shader. This is view-dependent screen-space refraction, **not full spectral path tracing or an exact multiple-interface optical solution**. It can still show approximations in strong refraction and close-ups.

## Rings

Finish-on / finish-off browser captures isolated a contribution from the fine machining map to the visible circular interference. The material now fades unresolved roughness contrast toward the map mean based on its screen-space footprint. Close, resolvable detail remains. Final material dithering also addresses display quantization; it is separate from the moiré mitigation. Geometry was not blurred or removed.

## Checks and evidence

`verify_flip.py`: 72 complete, individually hashed, distinct meshes; constant particle count; all recorded pressure solves converged; zero reported particle-solid violations; maximum reconstructed volume error 0.7233% relative to nominal primary-particle volume. This is not a local incompressibility certificate or a multiphase/air-bubble simulation.

`verify_web3d.py`: original normal/UV/index checks still pass. Node syntax checks pass.

Browser captures on the build drive, `D:/CYBR-build/exploded-instrument/output/playwright/3d/`:

- `fluid-plate-final.jpg`, `fluid-mobile-final.jpg`
- `fluid-ring.jpg`, `fluid-ring-no-finish.jpg`
- `fluid-detail-0.jpg`, `fluid-detail-24.jpg`, `fluid-detail-48.jpg`, `fluid-detail-71.jpg` (isolated diagnostic close-up; other modules hidden, actual browser materials and meshes)

Six-second desktop scroll sample at 1586×992: median animation-frame interval 6.1 ms, p95 12.2 ms, no intervals over 33.4 ms, no page exceptions, zero draws during settled idle. Both passes total 139 calls / 5,784,888 submitted triangles at the measured alignment pose. This costs more than the previous single-pass view; it remains a local sample, not a physical-phone or universal GPU guarantee. No horizontal overflow at 390×844.

## Rebuild

Run `node portfolio/instrument/bake_flip.mjs D:/CYBR-build/exploded-instrument/fluid-v2` for the offline bake, then copy the verified output into `portfolio/assets/instrument-fluid`. Run `verify_flip.py` using the existing build Python environment. The unused first diagnostic cache on the build drive contained empty reconstructions and is **not** the delivered cache.

The original `instrument-preview.html`, `instrument.css` and `instrument.js` are unchanged. The prior interior camera-route limitations remain outside this fluid/material pass.
