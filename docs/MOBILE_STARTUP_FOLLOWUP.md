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
was opt-in at PR9 with `?startup=warmup`. The later default-warmup review
below supersedes that selection policy. Original
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
single GL upload/query is atomic and can exceed a scheduling budget. That
phase is independently checked in the default-warmup follow-up below.

Physical-phone performance, memory pressure, cold mobile network delivery and
inherited optical refinement remain unverified. This laptop pair establishes
functional preservation and the observed timings, not a solved phone experience
or final art acceptance. Merge and Site deployment are coordinated separately.


## Mobile default warmup review (2026-10-08)

This focused follow-up selects the existing, unchanged `prepareStartupTextures`
path for ordinary mobile visits and `?startup=profile` or `?startup=warmup`.
`?startup=off` restores the PR9 first-draw upload timing; `?startup=full`, other
explicit startup variants, desktop and path tracing retain their earlier paths.
Whole-texture and tiled experiments are not included. No texture, resolution,
material, geometry, camera, motion or scroll-policy change is made.

The mobile loading class and rendering caption remain until the existing
first-frame GPU fence completes. CPU submission and full GPU-ready remain
separate timestamps. Queued texture work does not signal GPU completion.
Ungated compatibility rendering retains its original completion behavior.

CPU validation: all340 tests pass (338 retained plus two source-bound runtime
contracts covering selection/rollback, pending preparation and loading/fence
semantics). Syntax,15pages/1256references/0missing/9films and actual HTTP byte
checks pass. Both source manifests, all1548 tracked source files and all22
original texture encodings were verified. The helper is byte-identical to PR9.

One reverse-order native sequence tested warmup before baseline, first normal
motion then reduced motion. The native-tested implementation is
`a598a364345484f1be04e7e64ef17711ea17ebfb`, based on merged
`fc4847686acef4dd86b49fa14f411efe84d40777`. Later review edits change only
existing docs, test-prefix newline preservation and provenance hashes. Runtime
and all assets remain identical to the tested implementation.

Chrome145.0.7632.160, native Intel UHD ANGLE/D3D11,390x844,DPR1,touch/mobile,
CPUx4,80ms local latency, no bandwidth cap. Fresh contexts used the default
candidate with `?audit` and exact baseline bytes with `?startup=profile&audit`.
Chrome's sandbox stayed enabled; no security-relaxing flags were used. The
single browser slot lasted75.625s and all owned resources closed at
2026-10-08T03:57:45.776655Z, with no page errors or forced cleanup.

| Observation | Normal warmup | Normal baseline | Reduced warmup | Reduced baseline |
| --- | ---: | ---: | ---: | ---: |
| First full draw CPU submission |165.8ms|3100.9ms|141.9ms|3171.3ms|
| Loading touchstart processing delay |260.5ms|3105.8ms|282.1ms|3089.2ms|
| GPU full-ready from startup |17.782s|12.690s|13.943s|13.921s|
| Longest original warmup call |458.7ms|n/a|493.0ms|n/a|
| Document position at ready touchend |455px|455px|455px|455px|

The observed first-draw/input benefit survived reverse order. Total startup
was not consistently faster: the first warmup context took longer overall.
Shared driver/program warmth, profiling instrumentation and one fixed-order
sequence prevent a statistical, causal or physical-phone performance claim.
Normal loading touchmove delay still reached548ms; reduced reached598ms.
Original full-size GPU memory and atomic allocation/upload/mip work remain.

Actual normal opening and after-scroll PNGs were RGBA-identical (0changed
pixels across329160pixels each). Reduced opening images also matched exactly.
Both reduced touchend coordinates were455px; native inertia then advanced
warmup to619px while baseline stayed455px. Each GPU-completed displayed pose
matched its actual document coordinate. The reduced after-scroll images are
different poses (12248changed pixels) and do not establish matched-pose visual
parity. No synthetic images were used. All modes retained56meshes,
2096316triangles and decoded geometry SHA256
`486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756`.

The raw audit, phase/input checkpoints and eight actual PNGs are retained in
the isolated checkout's ignored `.local/native-reverse/`. Raw receipt SHA256:
`42366bf354b805dcdd68bfbc357aedb2a7675dabeb57f4d9d9e67a137a84bb94`.
Native mip readback was not repeated in this slot. The preceding baseline vs
existing warmup comparison retained equality for four original maps across47
mip levels; all22encoded source files are unchanged here. The failed tiled
candidate and its negative results remain independently preserved.

Physical-phone performance, coldWAN delivery, memory pressure, native context
loss/restoration, actual rollback-query browser navigation and reduced-motion
matched-pose after-scroll appearance remain unverified. Individual upload
stalls remain about470ms (493ms in this slot). Smooth loading and final optical
art quality remain unresolved. Review and Site saving do not deploy; the
parent coordinates the final merge and any later deployment.
