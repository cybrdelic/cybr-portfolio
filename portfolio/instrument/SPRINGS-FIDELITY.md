# Desert Hot Springs: recovered source baseline

The rejected workshop cartridge is not an accepted model. Do not use its
compressed mountains, thick cylindrical base or generic water as the reference.

## Completed on 2026-09-23

- Rebuilt all 23,690,858 original CYBR GEO triangles with seed 20260914.
- Retained source rock placements, pool functions, closed water enclosures,
  full-resolution ridge field, connected vegetation and R2 geometry treatment.
- Compiled the actual source renderer using MSVC C++17 / LLVM OpenMP.
- Preserved source camera, 72-degree horizontal FOV, sun direction, exposure,
  water absorption, 16 spectral bands, steam, photographic mineral detail,
  64 ordinary / 128 water samples and depth 12.
- Applied the original R2 albedo-demodulated finishing pipeline, white balance
  5750 and opaque filter strength 0.50.

The original renderer is **CYBR SCENES R2 / Hot Springs**, not the CYBR LIGHT
OptiX renderer. Generic Three.js materials or the current OptiX material subset
do not reproduce its sky, mineral response, water transport and atmosphere.
No native renderer substitution is being hidden behind the CYBR LIGHT name.

## Evidence

- Isolated build: `D:/CYBR-build/exploded-instrument/springs-faithful-v1`.
- Original and reproduced render: `/portfolio/springs-reference.html`.
- Published reproduction: `assets/springs-faithful/reproduced.png`.
- MAE 1.328 / 255; p99 absolute difference 14 / 255. Geometry hashes differ
  across the Windows rebuild and original Linux run; not bit-identical.
- Inspected both images independently: mountain outline and ridges, hero
  boulder, shrub positions, pool outline, submerged shelves, visible depth,
  mineral bank and steam are preserved. Small sample/platform differences remain.
- Native full image: 960 x 640, 224.026 seconds, zero nonfinite path samples.

## Memory recovery, disclosed

Initial source render reported `bad allocation`. At diagnosis Windows had
approximately 2.6 GiB physical memory and 1.9 GiB commit headroom available.
Only the triangle, order and BVH vectors were moved to file-backed allocations
in an isolated generated source overlay; source repo shading and geometry
were not edited. No other apps were stopped and no system settings changed.

That render wrote the complete image but exited 0xC0000005 during static
cleanup: the allocator registry was destroyed before global vectors. The
registry lifetime was corrected. A separate compiled regression exercises
global destruction, vector growth and independent mappings and exits 0.
The completed image was recovered only after verifying native metadata,
PFM dimensions, finite film values and exact guide/sample buffer lengths.
The full recovered render is therefore not represented as a clean-exit run.
Original failure logs and raw radiance are preserved. Future reproduction
compiles the corrected allocator.

## Still unfinished

### Revision housings14 — distinct module chassis

Scenes retains silver open circular flanges; Combat now has a dark bevelled
octagonal chassis, four feet and low clipped-corner side plates with bronze
cable sockets. Hardware groups switch with the selected module. The cable
route moves below Combat's thicker base rather than cutting through it.

Removed the grip cross/diamond shader completely. Plain satin metal and two
widely spaced geometric circumferential grooves replace it on Scenes. No
high-frequency grip pattern is used. Combat's initial new silhouette was
visually checked in `output/playwright/combat-housings13.jpg` (93,052 submitted
triangles, 69 draw calls, no page error). That image exposed cable/base overlap,
which was corrected in housings14. Follow-up browser verification timed out
and the test tab stopped responding; final cable clearance and Scenes close-up
are not visually verified. Server returned HTTP 200 for the updated JS.
No claim of final visual approval or new orbit performance measurements.

### Revision optics12 — water / housing redesign

`build_pool_field.py` samples the fused terrain into a 901x901 RGBA float
height/radiance field. `cartridge-water.js` refracts view rays into this field,
applies depth-dependent absorption/scattering, and traces reflected rays
against the same field before falling back to the native sky. Sky response
uses the source white balance/exposure curve. This is bounded height-field
optics, not full path tracing, FLIP, caustics, or reflection of all vegetation
and overhanging meshes. No screen-space background lookup or image sprite.

The housing has wider bevelled flanges, filtered grip-band shading, socket
fasteners on both faces, broad machined yokes, stepped cable glands, and
under-tray couplers oriented to the actual cable tangent. Default assembly
is closer together; view is closer. Mineral section uses source grain.

Inspected `springs-optics11-front.jpg` and `springs-optics12-left.jpg`.
Pool depth and hardware detailing improved versus joined8, but this remains
experimental: the cutaway is too regular, mountain shading is insufficient,
and the source concept's material richness is not yet matched. GLB export
explicitly rejects the custom water shader rather than silently losing it.

Desktop 30 two-RAF orbit samples: p50 12.1 ms / p95 12.3 ms; warm submission
0.9 ms, zero idle draws in one second, no page error, 107 draw calls and
2,506,485 submitted triangles. Callback timings are not GPU timings or a
mobile performance claim. Homepage unchanged.

### Revision joined8 — seam / false parallax correction

`stitch_springs_cartridge.py` builds a separate v3 package from the preserved
v2 meshes. It samples source triangle height/radiance into a 901-square grid,
joins the ridge to the foreground with a buried irregular graded transition,
and seals the resulting outer boundary. There is now one continuous terrain
mesh rather than a raised rectangular mountain patch. This is an authored
miniature, not a uniformly scaled geographic reconstruction.

The water uses only the upward-facing air/water interface. Screen-space
transmission was removed because of its apparent bank displacement during
orbit. It now uses transparent surface shading with native sky reflections;
this is intentionally an approximation, not physically complete refraction.
Actual geometric parallax remains normal for an orbitable 3D object.

Inspected `springs-joined8-left.jpg` and `springs-joined8-right.jpg` separately
under `output/playwright`. The straight floating apron is absent in both.
30 two-RAF orbit samples: p50 13.2 ms, p95 18.1 ms, no idle draws over one
second, 85 draw calls / 2,493,661 submitted triangles. Callback timing is not
GPU timing. Water still lacks the reference's richness and realistic optical
transport; mountain and section shading still need work. Homepage unchanged.

### Prior revision faithful5 (superseded by joined8)

The workshop now loads `assets/springs-cartridge-v2`: extracted recovered
scene geometry, native per-vertex diffuse sun/sky visibility bake, and separate
transmissive water. Mountains are an independently uniformly scaled insert.
No beauty image is projected onto the object. The shared Combat/Scenes carrier
has a thinner tray, smaller open flanges, lower yokes and visible cable route.

This is experimental, not approved parity: mountain lighting remains too dark
and speckled, the mountain/foreground join is too straight, water still lacks
the original renderer's transport, and the mineral section needs authored
surface detail. The compressed geometry is about 82 MB and needs further
optimization. No new homepage replacement or production camera-path bake.

Visual evidence: `output/playwright/springs-faithful-browser.jpg` (baseline),
`springs-faithful-v2.jpg`, `springs-faithful-orbit.jpg`,
`combat-housing-v2.jpg`. Desktop 1440x1000, DPR capped at 1.5: 30 orbit
samples using two requestAnimationFrame callbacks measured p50 12.1 ms,
p95 18.1 ms (browser callback timing, not GPU timing). No draws during a
one-second idle check. 2,577,607 source-package triangles; transmission
causes about 5.24 million submitted triangles / 172 draws. First shader
compilation took about 424 ms; warm render submission about 1.3 ms.
