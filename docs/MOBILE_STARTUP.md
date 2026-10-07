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
