# CYBR portfolio — current development snapshot

A source snapshot of the current CYBRDELIC portfolio, including the IRIS / 09 mechanism and the ELEMENTS volume renderer. The development entry is `portfolio/directions.html?concept=11` (Shadow Choreography). This snapshot contains current work from 20–22 October 2026; it is a review subset, with explicit exclusions below.

![IRIS / 09 in the actual portfolio](docs/media/elements-integration-iris.jpg)

![ELEMENTS in the actual portfolio](docs/media/elements-final-current.jpg)

![Recorded ELEMENTS motion](docs/media/elements-native.gif)

These are existing application captures from 22 October, not generated mockups. The GIF is a nine-second, 12 fps conversion of the [original recording](docs/media/elements-native-2026-10-22.mp4). It demonstrates a prior captured state; the snapshot has continued source development and is not certified pixel-identical to that recording.

## Run locally

Requirements: a current browser with WebGL2, floating-point render targets and filtering, `DecompressionStream`, and secure-context WebCrypto. The page reports missing capabilities before starting its renderer. Three.js r180 and three-mesh-bvh are bundled with their original MIT licenses. The static app needs no build or npm installation; use Python 3.10+ to serve it, or the optional Node 22 server below.

From the repository checkout root, enter this isolated review snapshot:

```sh
cd snapshots/2026-10-22-current
python -m http.server 4187 --bind 127.0.0.1
```

Open <http://127.0.0.1:4187/portfolio/directions.html?concept=11>. Serve the snapshot root (the directory containing this README), because browser imports and selected assets use sibling `cybr-*` directories. Use chapter buttons or scroll. Loading source volumes can take time and consume substantial GPU memory. Keep the server on loopback.

This is a bounded current-source package. It is **not yet a complete standalone release** of every portfolio chapter and archive page. SCENES deliberately shows included geometry and base materials, with a visible warning that its full native finish requires two excluded third-party rock textures. The older fluid playback loader references an unbundled historical mesh cache but is not used by the selected Concept 11 path. Archive detail pages, design boards, other concept variants, and their historical assets are excluded. These exclusions are documented in [scope and blockers](docs/SCOPE.md). Navigation stays within the included snapshot.

## Architecture

| Path | Responsibility |
| --- | --- |
| `portfolio/directions.html`, `directions.mjs`, `direction-11.css` | Seven-chapter presentation, scene lifecycle and camera/navigation |
| `portfolio/iris09-*` | Source-derived IRIS geometry, single-input constrained mechanism, lighting and optics adapters |
| `portfolio/assets/iris09/IRIS-09.glsl` | Preserved Revision III reference shader; source SHA-256 retained |
| `portfolio/direction11-elements-shader.mjs` | Integrated water, fire, air and fractured forms |
| `portfolio/elements-*.mjs` | Volume decoding, water transport, room/reflection integration and bounded composition |
| `portfolio/assets/elements-current/` | Native fire fields, water SDF and occupancy data |
| `portfolio/journey-projects.mjs` | Lazy loading of scene, score and mannequin chapters |
| `cybr-geo/`, `cybr-light/` | Selected technical drawing and material-map helpers, with existing component licenses |
| `docs/media/` | Reviewed screenshots and recording-derived GIF |

The default IRIS presentation uses raster PBR and bounded optical approximations. The preserved GLSL reference is a separate procedural fragment scene. IRIS constraints are geometric; no dynamics, fatigue or manufacturing certification is implied. ELEMENTS combines precomputed native fields and live shader evaluation; it does not run the native fluid solver in the browser.

## Validation and current status

The fresh checkout reproduced the original **97/100** CPU result. The three failed tests described older shader versions: a missing fixed fire-light loop, old ellipse support, and replaced polyhedral geometry. The current renderer was preserved; the tests now prove the current loop/call bounds, exact-zero annulus support, and conservative rounded-stone bounds. See the derivations in [portability and audit notes](docs/PORTABILITY.md).

The expanded regression suite now passes **118/118** on Windows Node 22. A real Chrome walkthrough also found an unconditional clearcoat field write that failed shader compilation. Both dry and wet floor paths now respect Three.js’s compile-time field guard. This is a rendering defect fix, not a change to native data or simulation solvers.

To use the optional portable server and tests on Windows, Linux or macOS:

```text
npm ci
npm test
npm run serve
```

For browser verification:

```text
npx playwright install chromium
npm run test:browser
```

The final Windows Chrome run passed all **18 browser checks**: seven chapters at desktop/mobile viewport sizes and four capability failures. See [current screenshots, timings and retained timeout evidence](docs/PORTABILITY.md#observed-results-22-october-2026). Mobile viewport tests do not represent a physical phone.

The repository-root workflow runs the same CPU and browser checks on Windows, Ubuntu and macOS. Hosted results are separate from local evidence. Browser coverage uses actual desktop-browser rendering at desktop and mobile viewport sizes; it does not certify physical phone GPU speed, every historical archive, or pixel identity with the older recordings above.

## Source and licenses

Live source folders were not modified. This follow-up branch records the compatibility changes in Git; original staged source bytes and hashes are recorded in the separately held snapshot audit; publication metadata omits personal absolute paths and chat identifiers. CYBRVOL1 metadata headers were sanitized while keeping compressed field payload bytes and their declared payload hashes unchanged. The IRIS provenance test was adjusted only to require the absence of private conversation metadata.

No new blanket license is assigned. Existing component and asset licenses are retained. See [third-party notices and asset scope](docs/THIRD_PARTY.md). Public distribution must use the reviewed file manifest and preserve these notices; the live workspace and historical output directories are outside the intended payload.
