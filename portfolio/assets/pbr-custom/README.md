# Custom CYBR instrument materials

These four material sets were made for the CYBR portfolio instrument. Their albedo appearance comes from three original OpenAI ImageGen images directed for this project. Their height, normal, roughness, metallic and fine cavity data are independently authored numerical fields. **No downloaded material maps are inputs to these custom sets.** Brushed/lathe are now **machining-v3-refined**; diamond finishes retain **machining-v2**. The previous packs are preserved in [fine-v1](../../output/geo-working/pbr-custom/history/fine-v1/snapshot-hashes.json) and [machining-v2](../../output/geo-working/pbr-custom/history/machining-v2/snapshot-hashes.json); the existing wear-v6 pack is unchanged.

| Set | Physical tile, mm | Authored surface | Height peak to valley, µm |
| --- | --- | --- | --- |
| BrushedMetal | 32 × 32 | Variable abrasive-track width/depth and drift, 180 finite scratches, partially burnished finishing passes | 14.06 |
| LatheMetal | 128 × 128 | Centered variable-feed cuts, resolved rounded widths, 65 interrupted finishing arcs and local polishing; common face for silver and bronze | 15.01 |
| DiamondKnurl | 279/17 × 10 | Rounded cut valleys and flattened crowns with periodic tool-position/depth variation and directional scuff | 75.32 |
| DiamondEtch | 10.4 × 6.5 | Shallow crossed rounded cuts with variable width/depth, tool drift and finishing scratches | 9.82 |

The tile dimensions and relief are explicit design values, not measurements of a manufactured alloy. The reported ranges are measured from the authored numerical arrays. The normal maps provide surface relief; CAD positions are not displaced.

## Authoring and appearance

Original images, prompts and the generation receipt are retained in `source-appearance/`. Each original is **1254 × 1254**, then resized to 2048 × 2048 for runtime. The numerical maps are authored natively at 2048 × 2048. The crosshatch appearance is used by both diamond finishes; each has its own physical height/roughness recipe.

- Brushed appearance: [original PNG](source-appearance/brushed-imagegen.png) · [generation prompt](source-appearance/brushed-prompt.txt).
- Centered lathe appearance: [original PNG](source-appearance/lathe-imagegen.png) · [generation prompt](source-appearance/lathe-prompt.txt).
- Crosshatch appearance: [original PNG](source-appearance/crosshatch-imagegen.png) · [generation prompt](source-appearance/crosshatch-prompt.txt).
- [Generation receipt and original hashes](source-appearance/generation.json).

Appearance is interpreted as sRGB and calibrated to a bounded linear metal-reflectance target. Periodic log-luminance correction retains bounded detail and mesoscopic variation around a mean metal reflectance; the authored scratch/groove masks add coherent minor marks. Runtime linear luminance varies by approximately 3.5–3.6% rather than the previous pack's approximately 0.6–1.3%. Paired boundary texels remove a color step at wrap. Source brightness never controls height, normals or roughness. The reflectance targets are authoring choices, not measured conductor spectra.

The roughness maps describe varied abrasive/tool pressure and partly burnished finishing, with changes at approximately 0.14–3.8 mm correlation lengths. Brushed roughness has median 0.330 and standard deviation 0.0315; the lathe's central 64 mm square has median 0.337 and standard deviation 0.0275. Live review found smeared haze in the previous coarse roughness response, so its coefficient was reduced from 0.036 to 0.018 on lathe and from 0.031 to 0.018 on brush. Every height, groove, arc, scratch, normal, albedo and cavity value was retained; only these two roughness channels changed. Rounded grooves have physical sigma widths of 0.025–0.055 mm for brushing and 0.065–0.125 mm for turning. The latter are at least one runtime texel wide at the 128 mm tile scale. Finer unsupported detail is represented by roughness statistics.

Lathe height is centered exactly at canonical Cartesian (0,0), UV (0.5,0.5), independently of the appearance image. A flat outer guard from radius 52 to 58 mm keeps the image perimeter continuous. Native circular faces remain inside that guard. Silver and bronze use the same machining maps; the bronze color profile is applied by the renderer.

## Data and mapping

Each `runtime/` directory contains 2K lossless WebP:

- `baseColor.webp`: sRGB RGB metal reflectance appearance.
- `normal.webp`: linear OpenGL tangent normal, +Y upward. It is derived as `normalize(-dh/dU, -dh/dV, 1)` using millimeter height derivatives. Start with normal scale (1,1).
- `roughness-metallic.webp`: linear data. R is a fine-scale cavity factor, G is authored roughness, and B is 255 for bare metal. R/G exactly match `source/cavity.png` and `source/roughness.png`. R is 1 for brushed/lathe; it ranges 0.780–1 for knurl and 0.920–1 for etch.

Physical array rows increase +V; raster rows are flipped once so +V points upward in the image. Height derivatives use periodic centered differences in millimeters, with normal scale (1,1). Runtime physical-normal mapping accounts for the map's millimeter scale; the anisotropy grain frame remains separate from the Cartesian cap normal frame. Groove floors and cuts contribute coherently to roughness. Fine cavity comes from the authored local cut/valley coverage. It is a bounded microcavity proxy for indirect lighting, not a scene occlusion bake or baked cast shadow.

The ring maps have 16 full U lattice periods and 10 full V periods per tile. The knurl's 279 mm angular chart closes after 17 full image tiles. The finer etch's 270.4 mm chart closes after 26. U is circumferential; V is axial. Brushed U follows the grain. Lathe face mapping uses centered Cartesian coordinates.

## Reproduction and checks

The deterministic authoring script and numerical fields are retained under [output/geo-working/pbr-custom](../../output/geo-working/pbr-custom/). Each set's `source.json` contains its actual source image/prompt hashes, downloadedInputs: [], tile scale, runtime hashes and source recipe path. `source/height.png` preserves height in 16-bit linear codes with its millimeter offset/range in `source/recipe.json`.

[Verification](../../output/geo-working/pbr-custom/verification.json) records 15 executed checks for OpenGL signs, height-derived normals, source scale encoding, packed channels, coherent cavity, resolved tool widths, roughness/detail hierarchy, nonuniform tool spacing, seams, closed repeats, source provenance, reflectance calibration and exact refinement invariance. It also verifies both preserved snapshots and existing wear-v6 bytes. The [contact sheet](../../output/geo-working/pbr-custom/custom-material-contact.jpg) shows height with display contrast enhancement, normals, roughness and albedo. The [source recipes](../../output/geo-working/pbr-custom/SOURCE-RECIPES.md) describe this revision and its limits. Normal relief and authored reflectance are material data; these checks do not establish photorealism or manufacturing accuracy.

See [NOTICE.md](NOTICE.md) for source status and authorship. Earlier downloaded trial maps remain in `../pbr-metal/` as retired material candidates. The default illumination is authored dark-room studio radiance with softbox and strip reflections. The separately credited photographed Studio Small 08 HDR remains available with `?pbr-env=photographed` for comparison.
