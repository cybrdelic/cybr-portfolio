# Mobile experience pass

This candidate starts from the exact application used by live Site version 9,
`fe39142403f13d3f35720aa07c0fb8d27748d3da`, merged as
`55b89affd81a0aa1398414fe229fe71d4a00655b`. The user's report is that the mobile
portfolio looks and feels bad even after native scrolling was restored.

The existing actual captures show a tiny horizontal assembly surrounded by
empty portrait space, followed by heavily cropped component close-ups. The
large header and hidden loading/project captions make those changes difficult
to understand. Functional input acceptance does not establish a good experience.

The candidate uses a compact top header and context caption, keeping the rest
of the viewport for the real instrument. The tall opening and closing
composition fits the entire assembly; project views fit each conservative
native CAD envelope and keep upright mechanisms upright. The camera moves
continuously between those views. Each project has similar native page travel,
while the original physical pose coordinate and all chapter destinations are
retained through an invertible map. There are no static project cards or
substitute beauty images.

Mobile rendering takes the latest native scroll coordinate directly instead
of adding another eased queue behind the GPU fence. Background reflection
refinement waits for scrolling to settle and then resumes at the original
quality. Unchanged stationary mobile poses reuse their camera/DOM setup.
The existing single outstanding frame gate, original geometry, materials,
asset bytes, pixel density and standalone manual GEO rotation remain.

The real GEO component stays clearly identified during full-model loading,
with modest user-controlled movement rather than repeated full rotations.
Loading text is visible. The header links to all projects and the current
caption opens its existing project details. Chapter shortcuts remain available
on keyboard focus without an ordinary bottom strip. The canvas installs no
scroll-driven drag capture and keeps native vertical pan. Reduced motion keeps
native page flow and immediate user-controlled poses; video/live-motion and
desktop preference policies remain.

The actual prior PR7 native receipt observed GEO at approximately 2.02â€“2.36 s
and the complete frame at 13.19â€“18.01 s under Intel laptop ANGLE, CPU x4,
80 ms per local request and no bandwidth cap. Those observations are the
baseline pipeline, not measurements of this candidate or a physical phone.
Older receipts include much longer reflection/input stalls. This pass does
not claim to eliminate GPU workload, cold-network delay or browser memory use.

CPU checks cover continuous/invertible pacing, reduced-motion and orientation
anchoring, camera-envelope fitting, unchanged physical geometry/rig constraints
and resource ownership. Opt-in `?audit` observers now remain through full-model
startup instead of stopping at four seconds, recording long tasks and supported
browser event timing. The frame gate records its worst completed wait. These
are measurement hooks; there is no normal-visit observer or reporting service.

The frozen implementation at `fabfe6391a9cd56953a52db315bbf864c999a6ef`
passed 324 CPU tests and a bounded native before/after comparison on 2026-10-07.
All six scoped native checks passed: baseline and candidate forward/reverse
canvas-area touch, candidate project-details open/close, and candidate reduced-
motion native page flow. Reduced-motion keyboard navigation also passed.
Actual opening, all six project frames, closing, first-GEO, wide opening/LIGHT
and reduced-motion LIGHT images were captured. The model retained 56 meshes,
2,096,316 triangles and the unchanged decoded geometry SHA-256
`486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756`.

The matched local comparison used a 390x844 emulated touch viewport, Intel UHD
ANGLE/D3D11, CPU x4, 80 ms per local request, no bandwidth cap and fresh page
contexts. First GEO was observed at 2.84 s before and 2.17 s after; full scene
at 19.43 s before and 15.89 s after. The largest recorded startup main-thread
long task was 5.82 s before and 5.04 s after. Sequential runs, driver warmth and
local delivery limit inference: these observations do not establish a causal
speedup, production-network performance or physical-phone acceptance. Heavy
startup remains an important open issue.

The comparison closed all owned browser/server processes and released the GPU
at 22:16:44 UTC after 67.0 seconds. Actual motion captures contain 88 baseline
and 90 candidate frames. CPU-only encoding preserves every frame and original
browser timestamps without interpolation or acceleration (5.233 s and 4.677 s).
The raw harness records the candidate head in both motion manifests; context
labels and separately served frozen checkout identify baseline/candidate.
The derived encoding receipt records both source and manifest heads explicitly.

Visual inspection found readable captions and a larger opening assembly; the
GEO chapter now shows the complete component rather than a severely cropped
close-up. Continuous transitions still crop neighboring components. Art
direction and physical-phone acceptance remain for review; these checks do not
certify final visual quality, memory use or smooth rendering on a phone.

A separate follow-up fixes only the space between opening sentences when the
wide layout hides its line break. A CPU text regression verifies the rendered
copy. Runtime JavaScript, camera numbers, pacing, CSS and assets remain byte-
identical to the natively tested implementation. The comparison images and
clips intentionally depict the tested implementation before that copy fix.
No further browser or GPU run is included. Parent review precedes deployment.
