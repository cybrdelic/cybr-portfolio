# Reference corrections / 22 September 2026

Scope: `instrument-preview.html`, its presentation assets, and the CYBR GEO / CYBR Light instrument bake pipeline. Existing homepage, detail pages, films and archive remain intact.

## Shape changes

- GEO: 120 helical knurl details, a service band, stepped front race and flange recesses; less mirror-black aluminium lighting.
- ELEMENTS: a partially filled vessel, curved free surface, air headspace, submerged bubbles, sealed compression fittings and one curved braided cable. The final v8 liquid cavity follows the jacket envelope, not the larger straight glass-port drilling.
- SONG: three revolved, dished and tapered cymbal profiles, raised bells, felt washers, lathe marks and stronger notation. The notation remains decorative, not a transcription of a real song.
- COMBAT: angular tapered paired links, cut-out webs, pivot caps on both sides, pushrods, shorter dark central actuator and a retained end seal.
- SCENES: bowed meridian struts, a faceted core, and branching mineral seams projected onto its hull. The seams no longer trace sphere meridians or triangle edges.
- LIGHT: retained coated lens, with a cable socket attached to its metal rim. The superseded central-socket render was stopped before delivery; its raw source/log remain on D:.

## Presentation

The supplied sigil bitmap is unchanged. An SVG luminance mask uses its white mark as alpha and paints only the mark black. No inversion or blend-mode rectangle remains.

Each module is rendered independently. This removes the occlusion holes in the old full-assembly masks. `package_individual.py` uses the same orthographic camera to place the unoccluded sprites and calculate connector positions.

External cables are lightweight SVG presentation spans with slack, shaft-aligned connector tangents, a shaded jacket and braid highlights. Internal cable geometry is baked by CYBR Light. External spans release before the specimen rearrangement and keep their curve rather than stretching between unrelated layouts. This is authored disassembly choreography, **not** a cable physics simulation or a validated mechanical assembly. Inter-object reflections remain baked.

Scroll sequence: exploded reference plate → connections released → six-part specimen layout → six individual close inspections → specimen layout. Upward scrolling reverses the same transforms. No duplicate image ghosts or continuous idle animation loop. A range control and endpoint buttons provide direct access; reduced-motion mode removes the long scroll track and retains these controls. No-JavaScript fallback retains the project links without the long track.

## Verification

Three visual passes: low-sample shape previews, desktop/mobile interaction correction, final production bake inspection. Raw render buffers, scene descriptions, STEP parts and bake reports remain on `D:/CYBR-build/exploded-instrument`.

- `test_models.py`: eight checks cover named-part validity, real water headspace, dished cymbals, a single slack internal cable, paired gripper links, bowed cage / branched seams, the knurl band and rim-mounted optical connector.
- `browser-probe.js`: 1586×992 forward/reverse states, 390×844 mobile, reduced-motion endpoint controls. All six sprites loaded; no horizontal overflow; reversing restored all six identity transforms.
- `performance-probe.js`: zero idle RAF callbacks in the measured interval, six image nodes, one cable SVG, no canvas, no load long tasks or layout shift. Local timing during concurrent offline renders is not a real-user performance guarantee.
- Representative screenshots: `portfolio/output/playwright/v7-*.png`.

## Reproduce

```powershell
$instrumentPython = 'D:/CYBR-build/exploded-instrument/venv/Scripts/python.exe'
& $instrumentPython portfolio/instrument/recipe.py --out D:/CYBR-build/exploded-instrument/geometry-v3 --module elements
& $instrumentPython portfolio/instrument/render_batch.py --folder D:/CYBR-build/exploded-instrument --modules geo song combat scenes --width 800 --spp 96
& $instrumentPython portfolio/instrument/bake.py --folder D:/CYBR-build/exploded-instrument --module elements --width 800 --spp 96 --revision v8 --threads 2
& $instrumentPython portfolio/instrument/bake.py --folder D:/CYBR-build/exploded-instrument --module light --width 800 --spp 96 --revision v8 --threads 4
& $instrumentPython portfolio/instrument/package_individual.py --folder D:/CYBR-build/exploded-instrument --width 800 --spp 96 --elements-revision v8 --light-revision v8
& $instrumentPython portfolio/instrument/test_models.py
```

These are reference-led authored models, not an exact reconstruction from CAD supplied with the reference. In particular, the optical interference pattern and the exact machining/engraving pattern differ from the concept image.

## Final delivery checks

- Six independent 800×640, 96-packet / eight-wavelength bakes: v7 GEO / SONG / COMBAT / SCENES, v8 ELEMENTS / LIGHT. All six native reports contain zero invalid path samples.
- 1,289 named source parts; 1,728,428 source triangles. These counts describe the source assets, not visual fidelity.
- The six cropped browser sprites total 321,040 bytes and decode to 6,363,924 RGBA bytes. Optical inset, thumbnail rail and original sigil are additional assets.
- Asset hashes and 35 local links verified, with zero missing links. Eight geometry tests pass.
- Final browser screenshots and JSON checks are in `portfolio/output/playwright/`. Desktop 1586×992, mobile 390×844; no horizontal overflow or broken images. Keyboard End and reduced-motion Specimens both settle at progress 1; Home and reverse scrolling return to 0.
- Final warm local load check after rendering: LCP 52 ms, load 34 ms, CLS 0, zero long tasks, zero idle RAF callbacks in the measured interval. These cached local values are not network or real-user benchmarks.
- All production render jobs are finished. The superseded central optical connector bake was deliberately stopped, not delivered. No user files were deleted.
