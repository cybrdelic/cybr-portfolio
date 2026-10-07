# Architecture

| Path | Responsibility |
| --- | --- |
| `portfolio/index.html`, `instrument-3d.js`, `instrument-3d.css` | Current main instrument and interface |
| `portfolio/instrument-*.mjs`, `instrument-*.js` | Geometry, camera, optical transport, material, playback and rendering modules |
| `portfolio/assets/` and `portfolio/vendor/` | Packed CAD, optical caches, films, material maps, local Three.js/BVH code and original notices |
| `portfolio/*.html` | Project pages, Notes, archive and retained alternate entrypoints |
| `portfolio/instrument/` | Authored native export/bake tools and portable CMake wrapper |
| `cybr-light/` | Explicit browser shaders, C++ renderer headers/source, Python scene/PFM API and referenced evidence |
| `cybr-geo/`, `cybr-elements/` | Selected mechanism source, playback helpers and referenced project evidence |
| `cybr-combat/`, `cybr-song/`, `cybr-scenes/` | Selected page/runtime media and supporting source; these are dependency subsets, not complete standalone repositories |
| `portfolio/tests/fixtures/native-optics/` | Three minimal retained optical regression fixtures |
| `portfolio/output/` | Six existing files linked by the active Notes page; newly generated proofs are ignored |
| `tools/`, `docs/` | Local source packaging, validation, native smoke and provenance |

The main default uses working CAD with WebGL2 hybrid raster optics and shared
cached ELEMENTS playback. Query-selected geometry variants and the optional
WebGPU path tracer remain available. No renderer, material, camera, motion or
layout source was redesigned in this cleanup. Bundled assets keep their original
paths, including cross-project `../` links. The independent `portfolio-next`
variant and the Fire Studio deployment copy are outside this package.

Generated output belongs under `.local/` or the ignored proof-output paths.
The source allowlist is explicit; a build cannot sweep in a browser profile,
Python environment, private checkpoint, log or unrelated project folder.
