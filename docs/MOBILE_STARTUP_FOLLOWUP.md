# Mobile startup repair

This candidate follows merged mobile PR8 and is reviewed in
[draft PR9](https://github.com/cybrdelic/cybr-portfolio/pull/9).
It moves the existing water boundary classifier to a worker and prepares the
actual mobile raster shader variants before the first full draw. Native
functional acceptance passed at implementation
`b5665dc38bf188ba2fa0293a37934b080d074012`; the review update changes only
documentation and its hash manifests. Site version 10 is the deployment
rollback. Saving a candidate Site version does not deploy it.

## Implementation and preserved behavior

`waterOuterBoundaryIndices` moved verbatim into a pure module. A module worker
classifies the selected ELEMENTS and SCENES optical water before mobile
thickness setup. Only copies of position/index arrays are transferred; the
original CAD buffers remain attached to the main renderer. Every derived index
byte and audit value matches the original synchronous implementation on both
actual water geometries. Unchanged results retain the original index identity.
Geometry/attribute versions reject stale results, and missing workers or
interleaved input retain the original synchronous compatibility path. Workers
terminate after success, failure or cancellation.

Default mobile raster prepares the actual glass/water thickness targets,
opaque/water HDR targets, full HDR scene target and display transform.
Compilation proxies share original geometry/material identities and use the
real scene's lights/environment. Live target, cube face/mip, viewport, scissor,
background, override material, tone/output settings, shadow and XR state are
restored before awaiting asynchronous shader readiness. Lazy uniform/attribute
reflection then runs in separate yielded tasks. Preparation does not render or
advance readiness/completion flags. Explicit ray/pathtrace preparation remains.

`?startup=profile` records inclusive first-draw substep timings and retains the
initial submit duration separately from later frames. Texture initialization
remains opt-in with `?startup=warmup`; ordinary visits keep it disabled. Original
texture bytes, mesh data, materials, camera/pacing, resolution and completion
semantics remain. The loading caption reads "Preparing the instrument."
Runtime caption spaces survive wide layouts that hide line breaks.

## Validation and actual visual evidence

All 338 CPU tests, syntax checks, source references and actual HTTP byte smoke
passed. Worker equivalence tests used the native ELEMENTS and SCENES meshes;
2,841,156 bytes of copied worker inputs left the original arrays unchanged.
All tracked source hashes and the two provenance manifests were verified.
Assets and sibling CYBR dependencies are unchanged from the earlier PR9 head.

One sequential native comparison ran the earlier PR9 control
`dccc509405689d1c32c0b85c6f5e50f6cb971cc0`, then the repaired implementation.
Both contexts used fresh disabled caches, a 390 x 844 touch viewport, DPR1,
CPU x4, native Intel UHD ANGLE D3D11 and 80ms local request latency with no
bandwidth cap. Both used `?startup=profile&audit`, with texture warmup disabled.

| Observation | Control | Repair |
| --- | ---: | ---: |
| GEO image captured (host upper bound) | 2,415.4ms | 2,212.0ms |
| GPU-completed full-ready from navigation | 18,459.0ms | 13,305.8ms |
| First full draw submission | 5,687.3ms | 3,136.0ms |
| Touchstart processing delay near 8s | 380.1ms | 13.9ms |
| Touchstart processing delay near 14s | 4,314.5ms | 10.4ms |

The 8s repair input occurred during shader preparation. The 14s repair input
occurred after full-ready, so it does not establish input responsiveness during
the remaining first-draw stall. Shared driver warmth, profiling overhead and
the fixed control-then-repair order prevent a causal speedup claim.

Both contexts retained 56 meshes and 2,096,316 triangles, with decoded geometry
SHA256 `486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756`.
Paired actual GEO images and full-opening images were byte-identical and
visually inspected. No synthetic images were used. A trusted 470px page pan
advanced the document 455px and pose to 0.04495, crossing the existing 0.035
opening hold. GPU-completed camera/model motion and condensation advanced in
both contexts, with no page errors. The earlier short-pan diagnostic failure
remains preserved; this new probe supplies the passing functional acceptance.

## Remaining issues and limits

Startup is still heavy. The repair's first-draw main-thread task lasted about
3.15 seconds, predominantly sampled `texSubImage2D` texture upload (~2.98s).
The water worker and shader preparation address earlier classification and
late shader reflection; they do not solve this remaining upload stall. A
single GL upload/query is atomic and can exceed a scheduling budget. Keep
texture warmup opt-in until independently validated during that phase.

Physical-phone performance, memory pressure, cold mobile network delivery and
inherited optical refinement remain unverified. This laptop pair establishes
functional preservation and the observed timings, not a solved phone experience
or final art acceptance. Merge and Site deployment are coordinated separately.
