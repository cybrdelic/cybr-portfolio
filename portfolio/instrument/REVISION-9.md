# Instrument finish revision 9

## Scope

Offline material/lighting correction. Same geometry, camera, 800 × 640 framing,
96 packets per pixel and eight wavelengths per packet as the previous sprites.
No realtime renderer or animation workload is added to the website.

## What was wrong

- Aluminium and steel had wavelength-independent, generic eta/k constants.
- The material called “Satin nickel cymbal” was actually a plastic BSDF.
- The mesh exporter omitted UVs. Anisotropic brushing therefore followed the
  first edge of each tessellated triangle instead of the machining direction.
- Four nearly hard-edged rectangular studio cards dominated the reflections.

## Selected correction

- Tabulated aluminium (Rakić), chromium (Johnson/Christy), and nickel
  (Johnson/Christy) conductor constants. Chromium is a finish approximation;
  this is not a measured stainless-steel alloy, oxide stack, or aged surface.
- Per-corner UVs with local angular seam unwrapping: circumferential brushing
  on barrels and concentric brushing on end faces. Offset parts use their own
  bounding-box axis. A stable planar fallback covers degenerate axis triangles.
- Distinct anisotropic roughness for aluminium, chromium, and nickel.
- Broad feathered reflection cards, dark gaps and a narrow edge strip.
- Existing OIDN and display transform retained. Increasing spectral sample
  count alone was not treated as a material fix.

## Bounded visual comparison

Three GEO passes at 480 × 384, 32 packets, eight wavelengths, identical camera:

1. `v9-measured`: measured conductors and corrected tangent coordinates.
2. `v9-studio`: those changes plus graded studio reflections — selected.
3. `v9-machined`: subtle deterministic height texture — not selected because
   it did not produce a clear visible improvement at the comparison size.

Raw films, review JPGs, native reports and optical-constant source files are
under `D:/CYBR-build/exploded-instrument`. Legacy finish remains available for
reproduction; the experimental microfinish is opt-in and is not delivered.

## Sources

The CC0 [refractiveindex.info database](https://github.com/polyanskiy/refractiveindex.info-database)
provides the tabulated datasets:

- [Al / Rakić](https://refractiveindex.info/?book=Al&page=Rakic&shelf=main)
- [Cr / Johnson](https://refractiveindex.info/?book=Cr&page=Johnson&shelf=main)
- [Ni / Johnson](https://refractiveindex.info/?book=Ni&page=Johnson&shelf=main)

Original YAMLs, converted wavelength-in-nm SPD files, source URLs and SHA-256
hashes are retained in `studio/optical-constants` on the build drive.

## Reproduce

Use the build-drive Python environment, from the repository root:

```text
python -B portfolio/instrument/test_metal_finish.py
python -B portfolio/instrument/test_models.py
python -B portfolio/instrument/render_batch.py --folder D:/CYBR-build/exploded-instrument --modules geo song light combat scenes elements --width 800 --spp 96 --revision v9 --finish studio
python -B portfolio/instrument/verify_material_bakes.py --folder D:/CYBR-build/exploded-instrument
python -B portfolio/instrument/package_individual.py --folder D:/CYBR-build/exploded-instrument --width 800 --spp 96 --revision v9
```

Only package after visually checking all six review JPGs. The browser probe
stores matched before/after screenshots on the build drive. Cache versions
must be advanced when publishing sprites.

## Delivery verification

All six production images were inspected and packaged. Combined sprite size:
306,310 bytes, down from 321,040; decoded RGBA storage is unchanged at
6,363,924 bytes. All six native reports have zero invalid path samples.
The 26 numerical, five coating, eight geometry and two coordinate checks pass.
The desktop/mobile browser checks found no missing sprites or horizontal
overflow. Rapid scroll reversal restores all pieces, and idle RAF callbacks
remain zero. See `verification-v9.json`; `verification.json` retains the older
revision's baseline. Cache URLs in the preview now use `v=9`.

## Remaining limits

The reference contains more complex surface wear and manufactured details.
These changes do not establish an exact reference match or a color-calibrated
photographic pipeline. The observer is still the renderer's analytic CIE
approximation; the studio is authored, and the existing display white balance
is retained. Glass, water and the authored cable animation are not redesigned
by this material pass. Browser sprites contain baked, not view-dependent,
reflections.
