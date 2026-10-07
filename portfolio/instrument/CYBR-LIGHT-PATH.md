# Native CYBR LIGHT camera-path bake

The replacement pipeline uses CYBR LIGHT's C++ spectral path tracer and native
position/object AOVs. It does not use Mitsuba or Embree. CYBR GEO's current packed
v4 mesh, actual exported assembly transforms, six cable spans, and recorded
FLIP fluid states are exported for each authored camera view.

## Delivery contract

- 49 final views, 1280 × 800, 128 wavelength packets × 8 wavelengths; 20 bounces.
- Measured Al/Cr/Ni conductor data, Cauchy glass/water, thin-film coated LIGHT lens.
- Authored neutral studio illumination; explicit OIDN and display transform.
- Native first-hit position/object maps gate radiance reprojection on real CAD
  geometry. Fixed-path appearance, not arbitrary-camera or relightable assets.
- Serial, fresh worker/native process per view. No GPU renderer or simultaneous
  render workers. No geometry decimation. Zero-area triangles are filtered and
  counted in each frame's geometry-audit.json.
- The eight previous Mitsuba renders remain in path-bake/instrument-path.
  Replacements are isolated in path-bake-light/instrument-path-light.
- Draft-prefixed views are never packaged or counted as completed final views.

## Commands

Use D:/CYBR-build/exploded-instrument/venv/Scripts/python.exe:

```
portfolio/instrument/test_light_path.py D:/CYBR-build/exploded-instrument/path-bake/path.json
portfolio/instrument/resume_light_bakes.py --build D:/CYBR-build/exploded-instrument
portfolio/instrument/verify_camera_path.py --cybr-light
```

The supervisor skips only completed views matching geometry, exact camera and
assembly state, quality settings, and the renderer/material pipeline hash. A
worker failure stops the queue and records the log rather than silently
lowering quality. Concurrent supervisors are blocked by a file lock.

Status: D:/CYBR-build/exploded-instrument/path-bake-light/job-status.json.
Review gallery: /portfolio/instrument/light-bakes.html.
3D preview: /portfolio/instrument-3d.html?cybr-light-bake.

The gallery reads completion from the actual batch and manifest. The existing
landing page remains unchanged. The replacement is opt-in until full-sequence
visual/motion QA; structural completion is not a claim of photographic parity.

## OptiX execution option

`bake_optix_path.py` exports the identical current scene and applies the same
offline finish, but uses the native CYBR LIGHT OptiX executable. The separate
`resume_optix_bakes.py` supervisor preserves completed CPU views matching the
same camera/material contract and renders only unfinished views on the GPU.
It uses the same batch lock as the CPU supervisor: do not run both queues.
Let an active CPU worker finish before handing over; never replace its executable.

GPU workers retain `native.gpu-checkpoint` and atomically write
`native-progress.json` with measured packet counts. A failed worker stops the
queue without reducing samples. Resume checks scene/assets/PTX identity and
film checksum. A GPU receipt also records the executable/PTX pipeline hash.
The Windows progress app distinguishes GPU sample progress from CPU activity.

The full-quality transition gate is `compare_full_optix.py`: fixed 1280 × 800,
128 × 8 spectral samples, matching IDs and positions, mean intensity checks per
major surface, and a labelled denoised CPU/GPU contact sheet for visual review.

## Verification required before promotion

All 49 camera conversions are ray-tested against the browser projection matrix.
Check native invalid-path counts, asset hashes, source identity, all six module
IDs, full 0–1 coverage, and dimensions. Visually inspect opening, lens, water,
and exit views, plus intermediate forward/reverse browser motion and coverage
diagnostics. Inspect fallback pixels rather than assuming every surface has
usable baked coverage. Remaining geometry/design limitations are not fixed by
changing the renderer.
