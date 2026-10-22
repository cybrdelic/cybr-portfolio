# Scope and remaining blockers

## Included snapshot

The package selects the current Concept 11 browser source, its CPU regression tests, exact IRIS / 09 Revision III GLSL reference, native ELEMENTS fields, live studio HDR, authored surface maps, current mannequin data with its separate license evidence, current scene geometry, score/audio, and actual screenshot/recording media. Historical source revisions are not combined into the current implementation.

## Exclusions and effects

- `cybr-scenes/environments/engines/geode/assets/inputs/cybr-geo/examples/desert_hot_springs_v3/assets/brown_mud_rocks_01_diff_2k.jpg` and `brown_mud_rocks_01_disp_2k.jpg`: exact external-asset license-to-file verification pending. Current native scene-finish loading needs these files.
- `portfolio/assets/instrument-fluid/`: historical mesh playback cache not selected for this bounded snapshot. The lazy historical fluid loader still references it; native ELEMENTS volume data is included separately.
- Archive/detail HTML pages, other concept variants and their image boards, legacy Combat inspector/armored soldier/helmet/films, old source/model iterations, downloaded material trials and multi-gigabyte archived wave/landscape assets are excluded. Existing links can reference these excluded routes.
- Browser profiles, sign-in images, remote attachments, raw chats, environment folders, caches, build output, diagnostic logs and shared output history are excluded.
- `reference27-ground-atlas/materials.bin` and `queries.bin` are authoring intermediates, each exceeding ordinary GitHub file-size limits; neither is required as the selected runtime albedo texture.

## Validation holds

The exact staged source has 3 failures among the 100 selected tests. These are shader/assertion mismatches, not missing files: loop inventory, air support culling and fracture-neighbor count. CPU tests do not certify rendering appearance. No new GPU session was launched because this is an inspection/staging task with active work continuing in the original workspace.

## Integration recommendation

Compare this manifest with the existing public `cybr-portfolio` repository and stage a non-destructive review branch. Do not overwrite its default branch, import live-worktree history, or make a duplicate repository. The source snapshot should remain a review package until the missing runtime assets and shader/test mismatch are resolved. Recorded media can support a draft README now, accurately dated and described as existing captures.
