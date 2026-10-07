# Mobile layout and lossless startup transfer

The source-publication baseline is commit
`d9cd9874d411d194b1b2a82ea6aaf97b9c3c8f7f`. This subsequent change addresses
the requested mobile scrolling and startup issues. Original laptop files and
the original packed geometry remain preserved.

At widths up to 900 px, the homepage uses ordinary page flow. Its canvas has a
stable height; scrolling does not change the instrument pose. The slider and
six chapter buttons control the same mechanism and camera path. Project links
remain readable below the model, with the existing details dialog and full
project pages. Mobile opens at the assembled pose (`0.28`); Plate and all six
inspection stops remain available. Desktop keeps its existing scroll tour.
Navigation and controls have at least 44 px height. Cached playback pauses
while the mobile canvas is outside the viewport.

The baseline downloads 44,827,908 bytes of gzip geometry, expanding to
96,899,824 bytes. The additional transfer file is 34,808,214 bytes: 22.35%
smaller. It applies reversible XOR prediction and byte-plane ordering to
existing attributes before gzip compression. A dedicated worker restores
the original bytes and verifies SHA-256
`486afb1b0c1ea6bb75642626beb6fb4b284db9824d99bdbb21de7ee7456fc756`
before transferring the buffer to Three.js. All 56 mesh records, positions,
normals, indices, UVs, finish data, material maps and rendering prescriptions
are retained. The original gzip remains available for older variants and
`?transfer=legacy` inspection. `.gz` files must be delivered as gzip files,
without HTTP `Content-Encoding: gzip`: the loader decompresses them itself.

Metadata requests and geometry/material downloads now overlap. Existing
water/fire data, optics and full material compilation still finish before
the first complete model. Progress reports actual downloaded bytes and named
setup phases; it does not estimate a completion percentage.

Reproduce the derivative from the retained original, without rendering:

```powershell
python -m pip install -r tools/requirements-native-smoke.txt
python tools/pack_geometry.py
node --test portfolio/instrument-geometry-codec.test.mjs
```

The byte-identity regression passed, together with the retained CPU tests.
Browser timing, touch navigation, viewport captures and production delivery
must be validated before calling this change a measured load-time improvement.
Smaller transfer size alone does not establish faster startup. Physical
Android devices and optional WebGPU quality mode require separate coverage.
