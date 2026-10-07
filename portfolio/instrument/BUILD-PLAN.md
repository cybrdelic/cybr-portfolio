# Exploded instrument — approved direction

Reference: the user's selected Exploded Instrument mockup. Generated components are visual design guidance, not recovered CAD. New components are an authored portfolio sculpture, not a functioning or manufacturing-qualified machine.

Pipeline: CYBR GEO named analytic parts → validated tessellation and individual source assets → CYBR Light native offline spectral renders → compact browser images. No live ray tracing or simulation. Preserve the existing homepage until the replacement has usable renders.

Six individually built modules: GEO machined chassis, LIGHT lens cartridge, ELEMENTS liquid chamber, SONG engraved score discs, COMBAT articulated gripper, SCENES faceted end cage. Individual fasteners, spacers, races and red conduit remain separately named. Use the approved artwork-02 identity. Do not repeat the concept's invented locations or coordinates.

Visual loop: first render the chassis/lens scene at preview resolution; inspect three bounded revisions at most for framing, bevel visibility, metallic contrast and glass readability. Keep raw native output, settings and timing. Final browser assets need dimensions, byte sizes, provenance and geometry counts. Rendering uses bounded CPU threads.

Browser interaction target: transform baked component layers along the assembly axis with a single assembled/exploded slider, project hotspots and baked detail previews. No continuous idle animation. Mobile gets a readable vertical composition. Exact inter-component refraction cannot remain physically correct while independently moving 2D layers; use baked endpoint views if it is visually significant.

## Setup status — storage recovered on X10 Pro

- Existing MSVC tools discovered at C:/VSBuildTools; no WSL installed.
- Native CYBR Light source built successfully using the local CMake wrapper. Output: native-msvc/Release/cybr-light.exe.
- Native numerical test executable passed 26 checks with zero failures.
- Initial C: dependency install failed from insufficient space. The newly attached D: X10 Pro is now the build drive; no existing user files were removed or drive formatting performed.
- Isolated CAD environment: D:/CYBR-build/exploded-instrument/venv. Temp files, pip cache, geometry and raw native renders remain under that same build root.
- Six initial modules built: GEO 155 parts, LIGHT 113, ELEMENTS 106, SONG 76, COMBAT 72, SCENES 110. Total 632 individually named parts, with per-part STEP exports and tessellation validation reports. These are first authored models, not final art approval.
- First native LIGHT preview: 640×512, 16 packets/pixel, 8 wavelengths/packet, zero invalid path samples, 27.22 seconds native render time; 58,580-byte WebP. Visual inspection found grain, weak metal contrast and dark glass. A second preview addresses the camera angle and reflection flag, with increased samples.
- Existing homepage remains unchanged until the asset quality gate is met. Still required: art refinement, conduit, final bakes, selected-direction frontend integration, and measured browser performance. Do not treat these initial component bakes as completion of the portfolio.
- Completed first bounded three-preview visual loop. Pass 2 (`light-640-96spp-review.jpg`) improves lens readability and noise, but metal remains too flat: 190.84 seconds native render, zero invalid paths, 26,670-byte WebP. Pass 3 (`light-640-48spp-review.jpg`) reversed the camera and reduced environment intensity; it made the asset too dark, so those changes were reverted. Raw evidence stays on D:. No final visual acceptance or browser-performance claim.
- Corrected the GEO bearing balls to full spheres; regenerated and validated. Current complete initial set: 727,162 triangles across 632 parts, zero invalid-part checks. Renderer numerical tests re-run: 26 passed, zero failed.

## Reproduce on the X10 Pro

Run from the CYBR workspace in PowerShell. Keep the drive attached at D:.

```powershell
$instrumentPython = 'D:/CYBR-build/exploded-instrument/venv/Scripts/python.exe'
& $instrumentPython portfolio/instrument/recipe.py --out D:/CYBR-build/exploded-instrument/geometry-v2 --module light
& $instrumentPython portfolio/instrument/bake.py --folder D:/CYBR-build/exploded-instrument --module light --width 640 --spp 96 --bands 8
```

The six module names are `geo`, `light`, `elements`, `song`, `combat`, `scenes`. Each geometry folder includes `manifest.json`, `meshes.npz`, `validation.json` and individual STEP files. Render folders contain native scene sources, float buffers, object IDs, native diagnostics, transparent WebP and a neutral review JPG. `*-bake.json` records settings, timing and output checksum. No automatic cleanup or drive formatting is part of this pipeline.

## Reference-rebuild pass — 2026-09-22

The first 632-part models did not meet the reference. This pass is a substantial rebuild, not a claim of exact parity.

- Corrected the studio emitter orientation; rejected the resulting panel occlusion and replaced finite panels with an authored linear-HDR strip-light environment.
- Rebuilt GEO as a vented shell with machined shoulders, fine lathe bands, a named identification plate and floating interface fasteners.
- Rebuilt LIGHT as separated mount/retaining rings around a convex lens, with markings and floating screws. A dark backing and authored dielectric coating improve the optical coloration; the reference's exact rainbow pattern has not been reproduced.
- Rebuilt ELEMENTS as a rounded-square hollow glass vessel with fluid and air voids; modeled paired braided conduit geometry.
- Added three concentric stave systems, note heads and stems to each SONG disc. These are authored decorative notation, not a transcription of a CYBR Song composition.
- Rebuilt COMBAT with connected, slotted paired cheek plates and pivot races rather than disconnected straight bars.
- Rebuilt SCENES with a veined obsidian sphere, six cage rails and socket-head terminals.
- Added a lossless single-layer dielectric coating to CYBR Light, its scene/Python API and five native numerical tests. Existing 26 numerical checks still pass. Polarized coated-glass transport explicitly throws rather than silently returning an unsupported result.
- Native triangles stream to disk rather than expanding the entire full-resolution instrument to Python dictionaries. Original source geometries and raw render buffers remain on D:.
- Offline output now uses OIDN 2.5.1 normal/albedo guidance, illuminant-E neutralization and a display transform. Native render reports still correctly state no in-render denoising; the separate bake receipt explicitly records postprocessing.
- Second visual loop: v2 light (panel occlusion, rejected), v3 light (improved form, washed-out glass), v4 full plate (orange cable and disconnected gripper exposed), v5 lens (contrast improved), v6 full plate (corrected cable/gripper/backing, high-resolution render). The matching v6 macro is a production close-up using that last configuration.

The browser candidate is `portfolio/instrument-preview.html`, not the production homepage. Its composition follows the supplied reference and uses the approved sigil artwork. `package.py` crops alpha layers and emits placement CSS/provenance. No live renderer, canvas or RAF loop is loaded. The assembly slider is an image-layer illustration, not a physically re-rendered assembled CAD state.

Interim browser checks, before the v6 plate replaces the v4 assets: 1280×720 desktop LCP 220 ms / load 170 ms; 390×844 phone LCP 128 ms / load 120 ms. Both reported CLS 0, zero long tasks, zero missing images and no horizontal overflow. These are local cached/development measurements, not network or real-user performance guarantees. Keyboard Home/End and endpoint buttons were tested. Console contained no warning/error messages.

The initial cropped prototype's seven image layers decode to 1,748,784 RGBA bytes, versus 28,672,000 bytes for seven full-frame 1280×800 layers. Final numbers must be read from the latest published provenance after packaging.

### Delivered candidate and remaining differences

- Candidate: http://127.0.0.1:4173/portfolio/instrument-preview.html. The old homepage and project evidence pages are not replaced.
- Final full plate: 1600×1000, 96 packets/pixel, eight wavelengths; 1,064 named parts including conduit, 1,694,342 triangles. Native render time 1,291.30 seconds, zero invalid path samples. Raw/denoised films, scene and masks are retained on D:.
- Matching 640×512 LIGHT close-up: 128 packets/pixel, 444.06 seconds native. Complete 640×512 SCENES cage: 96 packets/pixel, 207.91 seconds native. Both report zero invalid path samples. The separate cage bake repairs the clipped silhouette in the original full-scene framing.
- Packaged imagery: fourteen WebP files totaling 186,056 bytes. Seven cropped assembly layers decode to 3,069,056 RGBA bytes. The original sigil is separate and preserved.
- Browser comparison at the reference-sized 1586×992 viewport: local warm LCP 116 ms, load 105 ms, zero long tasks/CLS/missing images/overflow. Final 390×844 check: load 76 ms, zero long tasks/CLS/missing images/overflow; LCP unavailable (null), not zero. No console errors/warnings. Keyboard Home/End verified. Temporary viewport overrides reset.
- Twenty-six existing native numerical tests, five new coating numerical tests and five coating API tests pass. API tests cover native serialization, mutated invalid settings, and explicit rejection by unsupported portable/polarized paths.
- Initial module offsets opened gaps in the conduit's occlusion mask; removed at rest. The conduit hides during gathering rather than showing broken mask segments. The gathered state remains an illustrative image-layer arrangement, not a validated mechanical assembly or a re-rendered optical state.
- **Not an exact visual reproduction:** the brushed/machined surface detail is still simpler than the reference; the lens's interference pattern differs; the score engraving is less distinct; the obsidian veining is stylized. These are open art-direction issues, not things geometry/numerical tests certify.

Changed candidate files: `instrument-preview.html`, `instrument.css`, `instrument.js`, opt-in `instrument-qa.js`, generated `assets/instrument/`, and the scripts in this folder. CYBR Light changes add `include/cybr/thin_film.hpp` plus scoped material/parser/Python API and backend-validation support. Pre-existing `shader.hpp` Windows compatibility edits were preserved.

Only about 4 MiB was found in the old local build folders, so no folders were moved or deleted for cleanup.
