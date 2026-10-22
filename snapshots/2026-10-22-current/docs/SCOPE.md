# Scope and remaining blockers

## Included snapshot

The package selects the current Concept 11 browser source, its CPU regression tests, exact IRIS / 09 Revision III GLSL reference, native ELEMENTS fields, live studio HDR, authored surface maps, current mannequin data with its separate license evidence, current scene geometry, score/audio, and actual screenshot/recording media. Historical source revisions are not combined into the current implementation.

## Exclusions and effects

- `cybr-scenes/environments/engines/geode/assets/inputs/cybr-geo/examples/desert_hot_springs_v3/assets/brown_mud_rocks_01_diff_2k.jpg` and `brown_mud_rocks_01_disp_2k.jpg`: exact external-asset license-to-file verification pending. The full native scene finish needs these files. This snapshot explicitly disables that finish, retains the included geometry/base materials, and shows the limitation in the SCENES status and diagnostics.
- `portfolio/assets/instrument-fluid/`: historical mesh playback cache not selected for this bounded snapshot. The lazy historical fluid loader still references it; native ELEMENTS volume data is included separately.
- Archive/detail HTML pages, other concept variants and their image boards, legacy Combat inspector/armored soldier/helmet/films, old source/model iterations, downloaded material trials and multi-gigabyte archived wave/landscape assets are excluded. The selected snapshot navigation now stays within included chapters and scope documentation; unselected legacy modules are not supported entry points.
- Browser profiles, sign-in images, remote attachments, raw chats, environment folders, caches, build output, diagnostic logs and shared output history are excluded.
- `reference27-ground-atlas/materials.bin` and `queries.bin` are authoring intermediates, each exceeding ordinary GitHub file-size limits; neither is required as the selected runtime albedo texture.

## Validation and portability follow-up

A fresh checkout reproduced the original 97/100 selected tests. Three stale contracts were replaced with analytic proofs for the current shader: exact loop inventory plus nonrecursive call graph, explicit annulus support, and perturbed radial stone bounds. The production ELEMENTS shader and native fields are unchanged. The expanded suite passes 118/118 locally; see [derivations and setup](PORTABILITY.md).

A real Windows Chrome walkthrough found and fixed invalid clearcoat struct writes in the floor shader. A capability bootstrap now reports unsupported WebGL2, float targets and filtering, gzip decoding and WebCrypto. Desktop and mobile viewport evidence is recorded separately from older showcase media. It is not physical-device performance certification.

## Review boundary

This remains a non-destructive follow-up branch based on the current-source migration snapshot. The live portfolio, GEO work and repository main are untouched. Excluded licenses/assets remain unresolved; no new blanket license or replacement asset is introduced. Original source provenance and component notices remain in place.
