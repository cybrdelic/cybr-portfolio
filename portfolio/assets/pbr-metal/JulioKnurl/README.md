# Julio Sillet knurled metal

**Retired material trial.** Source files and attribution are retained for the earlier trial; the current instrument uses [original CYBR custom maps](../../pbr-custom/README.md).

**Attribution:** “Metal Knurled 01 03” by Julio Sillet, CC-BY; distributed via MatSynth by Giuseppe Vecchio and Valentin Deschaintre.

The exact MatSynth material record is `js_metal_knurled_001_003`, row 0 of `data/train-00233-of-00431.parquet`. Its metadata states **CC-BY** without a version. The record's author link is [Julio Sillet](https://juliosillet.gumroad.com/). The public [Mix 01 pack](https://juliosillet.gumroad.com/l/Uiidb) is contextual source information; the downloaded map bytes came from the [official MatSynth repository](https://huggingface.co/datasets/gvecchio/MatSynth). No checkout, account, email, or purchase was used.

This is an authored, procedural PBR material. It is not a photographed scan, and no measured physical tile size is supplied. The source date is 2023-10-31. Exact source metadata, map hashes, extraction receipts, image statistics, and physical-scale notes are in [source.json](source.json).

## Maps

`source/4k/` retains the extracted 4096 × 4096 PNG bytes for basecolor, normal, roughness, metallic, and 16-bit height. Runtime files are 2048 × 2048 lossless WebP:

- `runtime/baseColor.webp`: source basecolor, sRGB. It is a very dark metal albedo; the source mean is about 12.65/255 and maximum 48/255.
- `runtime/normal.webp`: tangent normal, OpenGL **+Y upward**, linear data. No axis rotation or green inversion was applied.
- `runtime/roughness-metallic.webp`: linear data. G is roughness, B is metallic, and R is constant 255 and unused. Source metallic is entirely 255. Roughness is not normalized or remapped.

Runtime maps use Lanczos downsampling. Lossless roundtrip pixel equality was checked. The packed G and B channels exactly equal their independently resampled source grayscale images. Copies in `runtime/` have exactly the original runtime WebP hashes, and all raw-source PNG hashes remain unchanged. The height map is source evidence only; this map pack does not displace or change CAD geometry.

## Native part scale

Image analysis finds 16 complete horizontal repeat periods and 10 complete vertical repeat periods, with staggered half-cells. Those image periods are measurements; all millimeter values below are authored design choices.

- A nominal 16 × 10 mm tile gives about 1 × 1 mm complete repeat periods.
- The GEO `geo__knurled_service_band` chart angular length is 279 mm. The authored U tile is `279 / 17 = 16.41176470588235` mm, closing 17 complete image tiles around the band. V uses 10 mm. The circumferential chart repeat is about 1.026 mm.
- The authored 10.4 × 6.5 mm tile gives about 0.65 × 0.65 mm repeat periods. The `light__exploded_locking_ring` chart angular length is 270.4 mm, so 26 complete U tiles close exactly at 10.4 mm each.

U follows circumferential angle and V follows the native cylinder axis on these parts. Full-image closure includes the source's nonuniform color and roughness, so closing only the diamond frequency is insufficient. Preserve UV handedness in the normal tangent frame, and use consistent map transforms and vertical orientation for all three runtime textures.
