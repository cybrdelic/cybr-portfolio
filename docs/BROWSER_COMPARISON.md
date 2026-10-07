# Baseline and staged browser comparison

The current default main workflow was exercised against the frozen D-copy and
the isolated staged package on 2026-10-07. Runtime source was unchanged. The
results support preserving the tested main workflow, with the limits below;
they do not certify every visual state, device or optional renderer.

## Source and settings

- Baseline: independently hash-verified `portfolio/d-copy` recovery snapshot.
- Staged entry: `portfolio/index.html`, loading `instrument-3d.js?v=elements-shared-4`.
- Entry SHA-256: `14001d4f3612df9b58d0c2b9d413562163594da886a689f88c026214c0fc4c09`.
- Runtime JS SHA-256: `603498098d013b328bb48b014d6b349239d23ccfb1da8ce63dc5fd724c967cac`.
- Source manifest SHA-256: `89b1206b8a85c733f915ab5df90128509c4a5cef68ff37c8fa4032bc42cc7129`.
- One isolated Chrome/Playwright profile; sequential loopback ports 4186/4185.
- Desktop: 1280x800, device pixel ratio 1, normal motion, default
  `working-cad-hybrid-raster-webgl2`; actual ANGLE hardware renderer was Intel
  UHD / D3D11. The optional WebGPU quality mode was not exercised.
- Mobile check: 390x844 at device pixel ratio 1, emulated reduced motion.
  This was a viewport check, not a physical mobile-device test.
- Main comparison used `?audit=1`; recording used the bare staged `/portfolio/`.

## Actual workflow observations

Both runs loaded ready and traversed GEO, LIGHT, ELEMENTS, SONG, COMBAT and
SCENES. Each corresponding chapter had exactly matching target/progress,
camera vector and packed-geometry hash. No fluid/fire failure was reported.
The geometry snapshot hash was
`486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756`.
Exact observed state values are retained in [state comparison](browser-state-comparison.json).

The study dialog opened at SCENES, Previous selected COMBAT, Next returned to
SCENES, and Escape closed it in both runs. Keyboard End on the progress slider
reached progress 1 with matching camera; Plate reset to progress 0. Notes
opened with 46 receipt controls. The archive DOM contained 137 images and two
videos. Combat's retained film reached readyState 4 at 640x360 and advanced
past 0.15 seconds. Clicking its toggle left the already-autoplaying film
paused; this does not establish a separate manual-start test.

At the emulated mobile size, both main views loaded ready, had no horizontal
overflow, and produced identical screenshots. A full mobile tap/navigation
tour was not performed. The desktop main states also had no horizontal
overflow. No uncaught JavaScript page errors or failed application requests
were recorded in either paired run; the separately observed favicon 404 is
listed below.

## Pixel comparison

These are RGB comparisons of the captured screenshots, with channel values
from 0 to 255. A changed pixel means any RGB channel differed. Desktop images
contained 1,024,000 pixels; the mobile image contained 329,160.

| View | Changed pixels | Mean absolute channel difference | Maximum channel difference |
| --- | ---: | ---: | ---: |
| archive | 727,682 / 1,024,000 | 95.328198893 | 255 |
| combat-film | 796,749 / 1,024,000 | 122.049746419 | 245 |
| combat | 0 / 1,024,000 | 0.000000000 | 0 |
| dialog | 50,101 / 1,024,000 | 1.093021159 | 32 |
| elements | 24,851 / 1,024,000 | 0.526828125 | 240 |
| end | 2,178 / 1,024,000 | 0.023935221 | 123 |
| geo | 7,453 / 1,024,000 | 0.221991536 | 215 |
| light | 1 / 1,024,000 | 0.000000651 | 1 |
| mobile-reduced | 0 / 329,160 | 0.000000000 | 0 |
| notes | 0 / 1,024,000 | 0.000000000 | 0 |
| plate | 303 / 1,024,000 | 0.019598958 | 219 |
| scenes | 1 / 1,024,000 | 0.000000651 | 1 |
| song | 0 / 1,024,000 | 0.000000000 | 0 |

SONG, COMBAT, Notes and mobile were pixel-identical. LIGHT and SCENES differed
in one pixel by one channel level. Plate and End had small measured differences
whose cause was not isolated. No timing or performance improvement is claimed.

The live water/fire clocks were not synchronized between navigations. GEO and
ELEMENTS are therefore workflow evidence rather than time-matched image
equivalence. Dialog transition timing was also not standardized. The archive
and film captures visibly had different scroll positions; their large pixel
differences are inconclusive for visual acceptance. A follow-up capture helper
timed out after 30 seconds waiting for image readiness. Its predicate was
corrected but not rerun after the hardware slot was released. This helper
failure is not established as a product regression.

| Chapter | Matching progress | Water frame baseline / staged | Fire time seconds baseline / staged |
| --- | ---: | ---: | ---: |
| GEO | 0.48993055555555554 | 6 / 7 | 0.579778 / 0.645748 |
| LIGHT | 0.55000000000000004 | 50 / 47 | 1.79654 / 1.737109 |
| ELEMENTS | 0.59999999999999998 | 94 / 83 | 2.834948 / 2.552487 |
| SONG | 0.69999999999999996 | 104 / 108 | 0.507063 / 0.099984 |
| COMBAT | 0.78003472222222225 | 90 / 100 | 0.991576 / 0.665306 |
| SCENES | 0.86006944444444444 | 90 / 100 | 0.991576 / 0.665306 |

## Existing warnings and errors

| Observation | Baseline | Staged | Interpretation |
| --- | ---: | ---: | --- |
| `GL_INVALID_VALUE: glTexStorage2D: Texture dimensions must all be greater than zero.` | 1 | 1 | Shared default-renderer warning |
| `GL_INVALID_OPERATION: glCopySubTextureCHROMIUM: The destination level of the destination texture must be defined.` | 85 | 79 | Shared warning; count varies with live workload |
| Uncaught JavaScript page errors | 0 | 0 | No observed exception |
| `/favicon.ico` 404 | 1 on initial cold baseline load | 1 | Existing missing favicon; warm baseline reload did not repeat it |

The initial cold baseline also logged a THREE shader warning X4000 about the
potentially uninitialized `dyn_index_vec3_int` variable. It was not repeated in
the warm paired run. Its absence from that run is not evidence of a cleanup
fix. Transparent optical approximation/distortion visible in the reviewed
views remains existing renderer behavior. No shader/material repair was made.

## Newly recorded staged evidence

`current-portfolio-progress.mp4` is a new recording of the bare staged current
main entry, including the six chapter selections, study dialog and Plate
reset. It contains no reused historical film or generated replacement imagery.
It is 74.24 seconds, 1280x800 at 25 fps, H.264 Main level 4.0, yuv420p, with
fast-start MP4 metadata and no audio; size is 5,203,000 bytes.
Encoding and full decode used CPU-only FFmpeg. All 1,856 frames of both the
VP8 source and MP4 decoded successfully. Representative frames across the
clip and detailed MP4 frames were visually inspected. The long initial Plate
dwell includes tool round-trip time and is not a performance benchmark.

- MP4 SHA-256: `b6489e460a56ffa70336bd866df264dbf9bd4b9c1d318d3bc89211b263b20cc6`.
- Original WebM SHA-256: `52981b87faba4a4ca5efc9f394d1a700e5966d33aea7d9256d3d46a28caaf3ae`.

The MP4 and raw screenshots/logs are review evidence outside the source tree;
the MP4 was also saved to the user's Library. The test browser was closed and
the hardware slot released before CPU encoding and documentation. No further
browser or GPU launch, remote source publication or live deployment followed.
