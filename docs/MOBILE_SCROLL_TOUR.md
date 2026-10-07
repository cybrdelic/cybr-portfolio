# Mobile scroll tour correction

The mobile interface again uses the desktop's continuous scroll-driven 3D
tour. The scene stays sticky while the instrument condenses, the camera aligns
with the cable, visits the six projects and exits to the whole assembly.
Intermediate page positions and reverse scrolling use the existing pose and
working-motion equations; chapter controls remain shortcuts within that tour.

This supersedes the ordinary mobile page flow introduced in PR #2. The mobile
viewport retains readable controls with 44 px targets, a fixed scene allocation
within the sticky viewport, and a compact landscape arrangement. Vertical
canvas gestures use native `pan-y`. Only pressed buttons/links pause rendering;
ordinary swipes keep advancing the latest pose behind the one-frame GPU gate.

The exact original geometry, materials, maps, resolution and decoding pipeline
remain intact. The complete native GEO component still appears first. Its
camera follows the same page progress while the full model loads, and the full
instrument resumes at the current page fraction without resetting to a fixed
mobile pose. GEO is the available component during this early phase; it does
not claim to depict the other five components before their bytes are ready.

CPU checks cover continuous intermediate/reverse coordinates, control-to-scroll
continuation, orientation clamping, modal/reduced-motion behavior, GEO input
cancellation and resource ownership, and exact geometry reconstruction. Source
references and films are checked separately. Native browser acceptance of this
correction is pending; the earlier `NATIVE_ACCEPTANCE.json` receipt describes
the PR #2 runtime and cannot certify the restored scroll experience.

Physical Android, cold-network performance and final pixel parity remain
unverified. The earlier native reflection refinement and memory limits remain;
this focused change does not claim to resolve them.
