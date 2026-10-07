# Mobile layout and progressive native geometry

The source-publication baseline is commit
`d9cd9874d411d194b1b2a82ea6aaf97b9c3c8f7f`. Original laptop files and the
original geometry package remain preserved. This update addresses the requested
mobile scrolling, navigation and startup problems.

At widths up to 900 px, the homepage uses normal page flow, a stable canvas and
controls at least 44 px high. Scrolling does not change the instrument pose.
The six existing chapter controls and project links remain usable during loading.
GEO opens in 3D immediately after its complete native component is ready; other
chapters open their existing project details until the full instrument is ready.
The starter's slider and horizontal drag rotate GEO; vertical gestures scroll the
page. The completed instrument restores its original arrangement slider, all six
inspection stops, Plate and the original full meshes and finishes. It opens at
the assembled pose (`0.28`) on mobile. Desktop keeps its existing scroll tour.

Mobile first transfers the complete six-mesh GEO component: **1,288,028 bytes**,
restoring **6,987,616 bytes**. Its decoded SHA-256 is
`0f058ab81c583fc70e7afccbf68f19002c0301a101af0715a6ea0c4e4585f335`.
It uses the original positions, normals, indices, UVs, occlusion and finish data,
the original photographed HDR and machined roughness, with an interactive camera.
This is a real native model, not a static image or simplified mesh. The starter
uses the existing procedural material finish while the final material maps load.
The full instrument follows in the background using the same renderer; starter
resources are released before the original complete scene is constructed.

The original full gzip is **44,827,908 bytes**, expanding to **96,899,824 bytes**.
The additional full transfer is **34,808,214 bytes**, 22.35% smaller. Both new
packages use reversible XOR prediction and byte-plane ordering before gzip.
A dedicated worker restores and hashes the native bytes. The full decoded hash
remains `486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756`.
All 56 mesh records and all final textures, material groups, shadow resolution,
transmission settings and reflection resolution remain retained. Progress shows
actual transferred bytes and separate first-usable/full-ready timestamps.

On mobile, reflection refinement waits for a settled pose and captures one of
the original six 128 px cube faces per frame, then convolves the complete cube.
Navigation discards partial captures. Each face restores all live renderer,
material, light and scene state. Refinement presents the existing full-resolution
HDR image when no visible scene state changed. Transmission read passes are
skipped only when conservative native bounds prove every optical mesh is outside
the camera. Offscreen ELEMENTS pauses its shared fire/water playback clock while
retaining the last radiance and bounded direct light. Resolution and authored
visible rendering settings are unchanged.

Reproduce both transfer files from the retained original without rendering:

```powershell
python -m pip install -r tools/requirements-native-smoke.txt
python tools/pack_geometry.py
python tools/tasks.py test
```

The original package remains available for older variants and
`?transfer=legacy`. Use `?startup=full` to bypass the progressive stage for an
explicit comparison. Browsers without Worker/SubtleCrypto use the original
complete startup. Serve `.gz` as a gzip file **without** HTTP
`Content-Encoding: gzip`; the loader decompresses it itself.

CPU regression validation passes, including exact full/GEO byte identity,
construction and disposal of all six GEO meshes, partial-capture cancellation,
per-face state restoration, conservative bounds and retained HDR presentation.
The prior full-transfer-only candidate failed the matched browser comparison:
layout improved, but first readiness did not improve and a LIGHT tap timed out.
This progressive revision has not yet completed browser acceptance. No measured
startup or input-latency improvement is claimed until a matched 10 Mbps aggregate,
80 ms latency, CPU x4 comparison records first usable real 3D, navigation latency,
full readiness and peak memory. SwiftShader emulation does not establish physical
Android GPU performance; physical-device and optional WebGPU coverage remain open.


## Post-load responsiveness follow-up

The matched SwiftShader comparison of `62083f3` observed complete GEO at 9.43 s
from navigation (captured at 9.61 s), compared with 78.58 s for the baseline's
first complete instrument. Early navigation actions took 57–295 ms. Full-scene
acceptance failed: a 24.44 s main-thread task followed full readiness, and the
existing canvas lookup/scroll timed out after 5 s. This was an unresponsive page,
not a missing canvas. Full-model ready timestamps were 64.37 s / 65.96 s, so
total full readiness was not improved. Those partial receipts remain preserved.

The follow-up keeps mobile GPU timing opt-in (`?timing=gpu`), retaining CPU
metrics without disjoint/query polling. The long task occurred outside the
measured draw submission and closely matched the 22.75 s startup GPU duration.
That correlation alone does not identify the driver, compositor or another
process as the cause. The later focused run below separates handler execution
from browser visual feedback; a short trace is still required. The measurement harness now uses cached adapter
metadata instead of making its own WebGL queries.

Reflection work now yields between at most 8,192 original triangles per
submission, in the vendored renderer's original opaque order. All six 128 px
faces, original background conversion, depth state and complete-cube convolution
remain retained. Background conversion also yields by native face. Capture
shader variants warm asynchronously before use; live state is restored before
awaiting. Navigation cancels partial geometry pieces and deferred work. A camera
or viewport change reuses the original 2048 px shadow map only when every tracked
world matrix, geometry/attribute identity, buffer version and visibility flag is
unchanged. Actual geometry changes invalidate it.

315 CPU regressions pass after the backpressure follow-up below. Browser
acceptance of that candidate remains pending.
The focused full-loaded chapter/landscape check retains the 5 s responsiveness
timeout and requires chapter tap actions below 1 s. It omits the repeated cold
baseline. A separate cold candidate check retains 10 Mbps aggregate / 80 ms /
CPU x4 conditions. The original baseline assertion tolerance is transparently
corrected to 0.001 to allow scroll pixel rounding (0.490044 vs 0.49). Previous
failure evidence is not overwritten. SwiftShader does not establish physical
Android GPU performance.

## Bounded mobile rendering candidate

The focused check of `fd4278d` completed and released its owned browser/server
in 53.91 s. Reflection slices took at most 16.4 ms of CPU submission time,
and mobile GPU timing queries were disabled. The 5 s canvas check and GEO tap
passed, but LIGHT took 4.81 s, ELEMENTS 9.74 s and SONG timed out at 10 s.
All-chapter and landscape acceptance therefore failed; this candidate was not
pushed or deployed.

Recorded click handlers took 1.6-2.2 ms, with 11.5-48.2 ms from event timestamp
to processing. Browser EventTiming reported 2.45-3.60 s from input to paint.
Playwright's action span also includes waiting before the browser issues input.
The next check records that pre-event wait, handler timing, actual browser
input-to-paint and selected geometry completion separately. A missing duration
inside JavaScript measurements is not proof of compositor causality.

The new mobile gate allows one outstanding WebGL frame, using zero-timeout
fence checks and coalescing subsequent requests to the latest target. It holds
submission and polling through a pointer gesture and for 120 ms afterward,
so chapter selection can paint immediate accessible feedback. Hidden canvases,
hidden documents and open project details pause waits and playback. Reflection
captures retain coherent partial work while paused; a new pose invalidates it
before resuming. Completed static frames do not request another render. Existing
reduced-motion behavior still stops the shared fire/water playback clock.

The gate retains the native final geometry, materials, buffers, optical settings
and shadow/reflection resolutions. It does not cancel commands already submitted
to WebGL. GPU fences establish when a selected pose has finished rendering;
they do not establish when the browser composites that image. Startup records
CPU setup and first GPU completion separately. Completion-wait duration includes
intentional interaction pauses and is not a hardware GPU duration measurement.
`?frame-gate=off` is available for a controlled comparison. Desktop and optional
path-tracing routes keep their previous scheduling.

CPU tests cover one-frame ownership, zero-timeout checks, coalescing, interaction
holds, visibility/modal pauses, idle frames, context failure and owned-resource
disposal. Probe tests check retained partial captures and invalidation on resume.
The pending focused browser check requires all six actual selected poses to
complete, keeps the existing 5 s canvas check and sub-second tap criterion,
checks landscape/reduced-motion playback, and records a short Chrome trace.
No new browser improvement or final visual equivalence is claimed yet.
