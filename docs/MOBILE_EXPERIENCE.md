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

The actual prior PR7 native receipt observed GEO at approximately 2.02–2.36 s
and the complete frame at 13.19–18.01 s under Intel laptop ANGLE, CPU x4,
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

Native before/after validation and physical-phone acceptance are pending.
The coordinated native comparison must capture the actual opening, all six
project frames, closing assembly and a short trusted scroll/reverse clip,
alongside startup, event, main-thread and GPU-completion measurements.
CPU numerical fitting does not constitute visual acceptance.
