# CYBR portfolio

The current laptop portfolio, organized as a self-contained source tree. The
main entry is `portfolio/index.html`, loading
`instrument-3d.js?v=startup-profile-1`. It presents the working CAD instrument,
cached ELEMENTS water/fire playback, and six project pages. The publication baseline preserves the original behavior and known defects.
Mobile uses the continuous scroll-driven assembly and camera tour, with a
sticky touch-safe scene. Progressive real GEO and lossless full geometry remain.
See [scroll-tour correction](docs/MOBILE_SCROLL_TOUR.md) and
[startup notes](docs/MOBILE_STARTUP.md), and the validated
[mobile experience pass](docs/MOBILE_EXPERIENCE.md) and the separate
[CPU-only startup investigation](docs/MOBILE_STARTUP_FOLLOWUP.md) for scope and verification.
Source publication and Site versioning are separate; this PR does not deploy
a Site. Final art quality is not certified.

## Run the current version

Install Python 3.10+ and Node.js 20+. The browser dependencies and existing
runtime assets are bundled; no npm install or asset regeneration is required.
Use a browser with WebGL2. Optional quality mode also requires WebGPU.

```powershell
python tools/tasks.py serve --port 4185
```

Open <http://127.0.0.1:4185/portfolio/>. Serve the repository root: serving just
`portfolio/` breaks the retained sibling-project URLs. The server binds to
loopback. Stop it with Ctrl+C.

```powershell
python tools/tasks.py test
python tools/tasks.py check
python tools/tasks.py smoke
python tools/tasks.py build
python tools/tasks.py check --root .local/dist
```

`test` runs the retained Node regressions. `check` checks HTML references and
the nine project films; FFmpeg/ffprobe must be on PATH. `smoke` serves and fetches
the actual main entry and representative packed runtime dependencies, without
starting a browser or GPU job. `build` copies a checked allowlist to a fresh
`.local/dist`; it preserves the current pages and relative paths. It does not
rerender assets. Remove an old dist manually before rebuilding; the command
refuses to replace it.

These checks supplement actual workflow and image comparison. Passing unit
tests does not mean the browser demo or its visual appearance passed review.

## Native offline workflow

Install CMake 3.16+ and a C++17 compiler. On Windows, use Visual Studio C++ build
tools. The retained CYBR LIGHT sources and headers build without the original
machine-specific native build cache.

```powershell
cmake -S portfolio/instrument/native -B .local/native-build
cmake --build .local/native-build --config Release --parallel 2
.local/native-build/Release/cybr-numerical.exe
.local/native-build/Release/cybr-coating-tests.exe
python -m pip install -r tools/requirements-native-smoke.txt
python tools/native_smoke.py --exe .local/native-build/Release/cybr-light.exe --label current
```

For single-configuration generators, the executable is directly under
`.local/native-build`. The smoke uses an actual retained GEO component and the
production scene/render/PFM API, with a fixed camera and seed. Its small, noisy
preview is functional evidence, not a replacement for a full instrument bake.

The older authored tools under `portfolio/instrument/` are retained source.
Full CAD/OptiX/simulation regeneration additionally needs the historical raw
input datasets, CAD Python environment, and optional renderer toolchains
identified by those scripts. Their original absolute build paths are not a
portable setup. Do not run `publish_home.py` as a default build: it regenerates
an earlier shell and can overwrite the frozen current homepage. Do not resume
historical bake queues as part of installation.

## Source and rights

See [architecture](docs/ARCHITECTURE.md), [source scope](docs/SOURCE_SCOPE.md),
[known issues](docs/KNOWN_ISSUES.md), [validation](docs/VALIDATION.md),
[browser comparison](docs/BROWSER_COMPARISON.md), and
[license inventory](docs/LICENSE_INVENTORY.md). The manifest preserves source
hashes and separately records the small cleanup edits. Originals and verified
recovery snapshots were left untouched. Generated caches, diagnostic runs and
old iteration outputs are absent from this working source package.

Third-party terms remain attached to each asset. The public package retains
the current Inspector/mannequin, films and stills. Four unused historical
Soldier model exports remain in private recovery snapshots and are omitted
from every public commit. See [publication boundary](docs/PUBLICATION.md)
and [current motion credits](cybr-combat/MOTION_LICENSES.md).

The historical `build_display_modules.py` tool expects the omitted old
`cybr-combat/demo-output/physical-animation-proof` scene, geometry and texture
inputs in its original workspace layout. Those optional private inputs are
not bundled or automatically downloaded. Its older Soldier `combat` output
is superseded. Current workshop assets are already included, and ordinary
serve/check/test/build commands do not run this historical builder.
