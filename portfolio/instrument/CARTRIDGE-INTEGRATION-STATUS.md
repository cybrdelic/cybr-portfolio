# Replacement cartridge integration

Status: staged real geometry; **not production approved or live**.

## Concept C containers — September 24

The workshop now uses distinct real-mesh housings: slotted articulated linkage
plates for Combat, and a thick optical-glass bowl on curved silver saddles for
Springs. Container-only GLBs are in `../assets/display-modules/` as
`combat-container-c.glb` and `springs-container-c.glb`. Native exports and
`container-c-validation.json` are in `../output/`.

Both exports passed geometry checks. The glass is watertight, consistently
wound, positive-volume, and retains transmission/IOR. Opposite-angle inspection
identified an intersecting mineral edge; the lower section now tapers inside
the bowl. These are interactive material previews, not final lighting bakes.
The older staged hero assets listed below have NOT been replaced with concept C.

The approved Concept C bake queue was started separately on September 24:
`D:/CYBR-build/exploded-instrument/container-c-bake/path-bake-light`.
It contains 49 freshly exported camera/assembly states, rendered serially at
1280x800, 128 packets, 8 bands, tile 512, inflight 4 with the verified v8 CYBR
LIGHT OptiX binary. Native geometry is in `container-c-assembly`, SHA
`7cba93e13ee713a2506de340831736f242b5a7581cae0d14ffd5842fdf92d6f8`.
Use that queue's `job-status.json` for current status; this note does not certify
completion. The Windows monitor was opened with `--build` targeting
`D:/CYBR-build/exploded-instrument/container-c-bake`.
No automatic live publication or visual approval is performed by this queue.

Scheduling-only tuning later on September 24 changed the queue to tile 2048,
inflight 4, with per-view fallback to 512 only on the explicit 1s launch gate.
From the same 8-sample checkpoint, samples 9–10 took 30.672s at tile 512 and
13.625s at tile 2048 (2.251x trace-stage speedup). Both complete checkpoint
files have SHA256 `d8ed0ae225958f8b9e9feb6e1d29337eac00a0baa60951de8733c9cbefd6a112`.
Maximum launches were 109.286ms and 109.229ms. The raw ten-sample images were
inspected individually and match; this is not final image-quality approval.
Scene setup still cost approximately 128–142s per benchmark launch. This
two-sample landing-view result is not a measured whole-queue speedup.
Raw metrics: `container-c-bake/batch-benchmark/status.json` on D:.
The original production checkpoint was preserved and the queue resumed from it.

## Targeted queue supersedes the full-frame queue

At the user's request, the full-frame supervisor was stopped. Its landing view
reached 128 samples but the renderer exited with `ERROR: bad allocation` during
final output; the full-sample checkpoint remains intact and is NOT a completed
receipt. Do not restart the old 49-full-frame queue automatically.

The active replacement is `D:/CYBR-build/exploded-instrument/container-c-targeted`.
It traces conservative screen rectangles around Combat and Scenes, retaining
all other geometry for light transport. Two offscreen views are skipped; 47
targeted views remain, with average rectangle area 35.56% of the full frame.
This area ratio is not a measured timing speedup. Quality remains 1280x800,
128 samples, 8 spectral bands. Visibility output only accepts Combat/Scenes IDs.

The isolated `portfolio/output/optix-targeted-v2` renderer adds a region-aware
checkpoint signature and reduces simultaneous CPU output buffers. Small fixture
tests confirm exact retained-region film/AOVs, zero film outside the region, and
unchanged full-frame output against v8. Raw test images were inspected separately.
This validates the region mechanism, not full-resolution visual approval.

Existing four-module bakes are untouched. Their reuse and changed indirect-light
effects still need integration review; no targeted assets have been promoted to
the live portfolio. Monitor this new folder's `path-bake-light/job-status.json`.

## September 26 recovery and integration staging

The targeted queue completed six receipts and stopped during view 006 scene
export when NumPy could not allocate 1.38 MiB. The exporter now transforms
memory-mapped geometry in 1024-face chunks instead of copying whole position
and normal arrays. Three tests pass, including transform/chunk-boundary,
degenerate-face, UV, and material equivalence. The failed partial export was
moved to `failed-export-006`, not deleted. Completed receipts remain unchanged.

The queue resumed from index 6 with explicit validation of the previous exporter
SHA `9648d6efe8d1320b1e988a11d12eaf99a7c8ac0baa11d3fc46b9eb4a264c42c2`.
View 006 exported successfully and advanced into GPU sampling. Read live status
for further completion; this note does not certify that the remaining views ran.

`/?cartridges=c` is now a hybrid staging preview. The 29 original surfaces in
GEO/LIGHT/ELEMENTS/SONG were checked against the new native geometry. Their old
bakes are retained; Combat/Scenes use a separate targeted bake layer. Six
targeted views are currently packaged by `package_targeted_preview.py`.
The manifest deliberately says `complete:false`, `stagingOnly:true`; indirect
lighting/camera coverage and the full scroll still require final review.
Browser checks passed at progress 0, .13, and .8 without runtime errors; after
settling, idle rendering was zero frames over one second. The hero screenshot
is `../../output/playwright/hybrid-hero-first-six.png`. No live promotion yet.

## Current source

- Actual `cybr-combat/assets/cybr_mannequin_male.glb`, source SHA
  `d8f06b3ce06df61cd8e1a34365e426724a7d3bf926e995ce3bc27cf8ea8ca23b`.
- Step-in cross, Contact frame 3201. Source XPBD cloth replayed for 44 steps
  at 120 Hz from the take start. Frozen garment copy fitted against posed body;
  source Combat files are unchanged. Fit diagnostics in the asset JSON.
- Physical Springs source, closed water, measured unlit terrain parameters.
  Lowered carrier, radial wall normals, bounded ring bevels, support feet.
- Exported harness routes, explicit stepped 0.96 mm to 2.35 mm cable junctions.
  No invented route copied from the previous assembly.

## Staged assets

- Browser: `../assets/instrument-cartridges-v1`, 2,007,734 triangles, 59 groups,
  25,929,874 compressed geometry bytes. SHA
  `aec3bb1d3bb983fef4478771c5a93b9ea21b437640145811de922a3f645ac3e8`.
- Native: `D:/CYBR-build/exploded-instrument/cartridge-assembly-v2`,
  4,217,517 triangles. SHA
  `12e34087817ad8c6921e209da9015dc31b1bb0e09902bb60d50c2f5abbd31e29`.
- `D:/CYBR-build/exploded-instrument/cartridge-path-v2/path.json`: 49
  revised camera/assembly states, exported from the real browser geometry.
- First diagnostic: index 0, 640x400, 32 packets, 8 bands, v8 native OptiX,
  refractive NEE, tile 128, inflight 4. **Completed and inspected:** zero invalid
  paths, 238.775 seconds tracing, maximum launch 118.284 ms. Actual traced
  triangles 3,999,920 (legacy static FLIP surface replaced by dynamic frame).
  This establishes functional integration, not production detail approval.
- Full-quality landing view: `D:/CYBR-build/exploded-instrument/cartridge-path-full-v1/000`,
  1280x800, 128 packets, 8 bands, tile 512/inflight 4. Started after diagnostic
  review. This obsolete-housing job was deliberately stopped at 114/128 after
  concept C approval. Its checkpoint is preserved; it is not currently running.

## Added support and verification

- Native hero export now retains triangle UVs and physical vertex color,
  roughness and IOR. UV/material directives track actual emitted primitive IDs,
  including removal of degenerate triangles. Two indexing tests pass.
- Custom cartridge material mapping does not collide with legacy material IDs.
- Springs absorption and scattering account for the miniature-to-hero scale.
- Isolated export/trace/finish processes avoid retaining Python mesh buffers
  during GPU acceleration-structure construction. Source hashes prevent unsafe
  checkpoint reuse. Existing production assets/binaries are unchanged.
- Staged browser loaded, zero JavaScript errors; real mesh hero and condensed
  states inspected. No sprites. CPU submission times are not an FPS claim.
- Publication refuses partial, draft, unreviewed, or geometry-mismatched paths.

## Not finished

Full-quality 49-view replacement bakes, visual coverage/scroll checks, final
performance verification, and live promotion remain. Source-specific steam is
not implemented. Springs diagnostic is too soft for final visual approval.
Garment fitting and miniature silhouettes need native close-up review. Do not
represent the current diagnostic as photoreal parity with the original scene.

## Evidence

- `../../output/playwright/combat-impact-fit-v2.png`
- `../../output/playwright/springs-fit-v4.png`
- `../../output/playwright/cartridge-hero-v2.png`
- `../../output/playwright/cartridge-condensed-v2.png`
- `../output/aov-validation-v8/result.json`
- `D:/CYBR-build/exploded-instrument/cartridge-path-v2/000/beauty.png`

No recurring automation or duplicate production queue was created.
