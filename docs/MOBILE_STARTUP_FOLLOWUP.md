# First-frame startup investigation

This separate candidate follows merged mobile PR8, source
`fb4734942cc3ee3f34af2d9693bf11b97452ebb1`. Approved Site version 10 stays live.
This candidate is CPU-validated only; it is not deployed and does not establish
a startup speedup or a solved phone experience.

The exact native implementation `fabfe6391a9cd56953a52db315bbf864c999a6ef`
recorded a main-thread long task from navigation time 10,707.8 to 15,747.8 ms,
duration 5,040 ms. Its `first-frame` mark was 10,708.0 ms and `ready` mark
15,737.8 ms: 5,029.8 ms between those marks. Source runs initial `drawScene()`
between them. This localizes the first-frame handoff, not the deepest call.
The run's observer recorded start/duration without a sampled JavaScript stack.
Older touch/chapter traces cover different postload work and cannot supply it.

The geometry worker already downloads, inflates, restores and verifies the
96,899,824-byte original buffer, then transfers it without cloning. Recorded
worker restore/verify times were 139/90.3 ms. Moving this work to another worker
does not address the later first-frame task. Mesh setup also has a yield after
each mesh. Individual chart/group operations may still be long; their costs
must be measured separately before a worker transformation is justified.

First draw calls lighting and probe updates, optical exit fields, original
opaque/water HDR passes and the final HDR composite. First-use texture/buffer
uploads, render-target initialization, shadow/optical shader variants and
driver waits are hypotheses. The old snapshot's submit duration was overwritten
by a later 35.8 ms refinement; it does not measure the first draw.

## CPU candidate

- `?startup=profile` records inclusive synchronous first-frame substep timings
  and retains `startup.initialSubmitMs` separately from later frames.
- `?startup=warmup` adds the same timings and, on native mobile raster only,
  initializes each unique original material texture across scheduled tasks.
  It targets a four-ms cumulative task budget. Individual GL uploads are atomic
  and can exceed it; the measured maximum is reported without a responsiveness
  guarantee. Render-target/depth, framebuffer and video textures are excluded.
- Ordinary visits keep texture preparation disabled. Original texture bytes,
  mesh data, materials, camera/pacing, resolution and ready/completion semantics
  remain. There is no placeholder, resolution reduction or early ready flag.
- Runtime prelude strings retain spaces when a wide layout hides line breaks.
  The regression evaluates the actual runtime assignment, including loading
  and later scroll captions. PR8's HTML-only check missed those rewrites.

Tests exercise deduplication through compiled uniforms, retained identities,
yield ordering, oversized atomic uploads, cancellation/failure propagation and
inclusive nested timing. They do not initialize WebGL or establish actual
texture-upload cost.

## Next evidence and fixes

Request an exclusive bounded native slot before running a browser. Compare
fresh `profile` and `warmup` contexts from one frozen source with the exact full
CAD, original pixel density, matched viewport/latency and actual geometry hash.
Capture from navigation through full-ready using Chrome tracing and sampled
JavaScript stacks, retain phase/upload metrics and exercise trusted scrolling
during startup. Capture actual GEO/full assembly and close all owned resources.
Reject a shifted stall or premature readiness as an improvement.

If the first-frame cost is predominantly an unwarmed optical/HDR/shadow variant,
prepare that exact variant with asynchronous compilation and restore all live
renderer/material state before awaiting. If texture preparation accounts for
it, validate the task queue and input response before considering it a default.
If pure chart/material grouping dominates earlier mesh tasks, transfer only
new derived arrays from a worker and compare every byte and material-group order
with the original implementation. The existing verified CAD buffer stays owned
by the main renderer. An OffscreenCanvas migration is outside this experiment.

Physical-phone performance, memory pressure, inherited optics and cold mobile
network delivery remain open issues. A single sequential laptop pair cannot
establish a causal speedup.

## Local repair candidate

The local successor moves `waterOuterBoundaryIndices` verbatim into a pure
module and runs it in a module worker before mobile thickness setup. Only
copies of selected water position/index arrays are transferred. The original
CAD buffers remain attached to the main renderer. Derived indices and every
audit value are compared with the synchronous implementation on the actual
ELEMENTS and SCENES water; unchanged-index results retain original identity.
Geometry/attribute versions prevent stale results from being reused. A
synchronous compatibility path remains for missing workers/interleaved inputs.

Mobile default raster also prepares the actual glass/water exit targets,
opaque/water HDR targets, retained full HDR target and display transform.
Compilation uses proxies with original geometry/material identities and the
real scene's lights/environment. Live target, cube face/mip, viewport, scissor,
background, override material, shadow and XR state are restored before waiting
for asynchronous shader readiness. Lazy uniform/attribute reflection follows
readiness in separate tasks; one GL query can still exceed a task budget.
Preparation does not render a frame or advance readiness/completion flags.
Explicit ray/pathtrace modes retain their existing preparation.

Texture upload warmup remains opt-in. No startup or responsiveness benefit is
claimed until a separately approved native comparison measures first usable
GEO, completed full frame, loading input and all startup tasks. The corrected
postload probe must cross the existing pose 0.035 assembly hold using trusted
page pans. The earlier failed diagnostic receipt stays unchanged.

This candidate is local-only. The parent coordinates any later transfer or
publication; no new source upload, public PR, push or deployment is included.
