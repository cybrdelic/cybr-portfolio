# Live opening

The homepage contains an opt-in Canvas 2D instrument, initially paused. It uses damped spring particles and three targets: a (2,3) torus knot, the approved `artwork-02.png` silhouette, and a travelling wave surface. It does not run the source CYBR simulation engines. The former font-generated wordmark was incorrect and has been replaced in both the live study and site branding.

`live.js` contains the renderer and interaction loop. `live.css` defines the immersive homepage composition. `exhibition.py` generates its accessible controls and project links. No dependencies or network APIs are required.

Controls: choose Orbit/Sigil/Tide, drag or use arrow keys on the focused canvas, adjust pointer force, scatter, reset, pause/resume. Vertical touch scrolling remains available. Reduced-motion starts paused; explicit resume is available. The loop suspends outside the viewport and while the document is hidden. Pixel ratio is capped and initial particle count is lower on narrow screens.

Verification: desktop 1280×720 and mobile-sized 390×844 screenshots; all three modes visually inspected; drag distortion, scatter/reset, pause/resume, keyboard focus, force slider and project-anchor navigation exercised. Offscreen simulation frame stayed unchanged across two observations. No console errors observed. `node portfolio/live.test.cjs` checks reduced-motion startup and control behavior in a DOM stub; it is not a rendering or physical-device test. `python portfolio/validate.py` reports 1,131 local references with no missing files.

Performance correction after user-reported slowness: all visitors start paused; opt-in drawing is limited to approximately 30 frames per second, 1× canvas pixel density and 1,380 desktop / 690 narrow-screen points. Depth buckets are populated once per frame instead of rescanning the complete particle set twelve times. Pointer movement while paused does not redraw. Control smoke tests passed, and paused startup plus approved-artwork use were checked in the browser. These are workload reductions, not a measured device-performance guarantee. Earlier performance assumptions were inadequate.

Known limits: the visual studies are deliberately stylized, not physically validated simulations. Physical mobile-device performance has not been tested. The static project collection remains usable without JavaScript. The user has not accepted the visual direction.
