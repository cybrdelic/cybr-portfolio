# Material and environment source notices

**Status:** the downloaded material maps below are retained as historical trials and are inactive in the current custom material loader. Current materials are [original CYBR sets](../pbr-custom/NOTICE.md), with no downloaded material inputs. Studio Small 08 is a separate live HDR lighting source.

## ambientCG / Metal 010 and Metal 051 A

Created using **Metal 010** and **Metal 051 A** from ambientCG.com, licensed under the **Creative Commons CC0 1.0 Universal License**.

- [Metal 010 source](https://ambientcg.com/a/Metal010)
- [Metal 051 A source](https://ambientcg.com/a/Metal051A)
- [ambientCG license](https://docs.ambientcg.com/license/)
- [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)

The source pages identify both assets as procedural. Runtime changes include browser-compatible 8-bit decoding, lossless WebP encoding, roughness/metallic channel packing, native-part mapping scales, varied normal strengths and authored color multipliers. Metal 051 A supplies the circular metal and warm bronze profiles. Complete source/download URLs and hashes are retained in each asset's `source.json`; runtime map records are in `runtime/maps.json`.

## Julio Sillet / Metal Knurled 01 03

**“Metal Knurled 01 03” by Julio Sillet, CC-BY; distributed via MatSynth by Giuseppe Vecchio and Valentin Deschaintre.**

- [Author and source](https://juliosillet.gumroad.com/)
- [Mix 01 material pack](https://juliosillet.gumroad.com/l/Uiidb)
- [Official MatSynth dataset](https://huggingface.co/datasets/gvecchio/MatSynth)
- [Retained exact material record and source hashes](JulioKnurl/source.json)

The MatSynth row is `js_metal_knurled_001_003`, row 0 of `data/train-00233-of-00431.parquet`, source date 2023-10-31. Its exact license label is **CC-BY**. The record does not specify a license version; this notice does not infer one. Its creation method is procedural, and its physical tile size is unspecified. MatSynth standardizes tangent normals to OpenGL +Y upward.

Changes made for this portfolio: 4K maps downsampled to 2K with Lanczos; lossless WebP encoding; roughness packed into G and metallic into B with constant unused R; authored ring mapping scales of `279/17 × 10` mm and `10.4 × 6.5` mm; profile normal strengths and rendering parameters. No image-axis rotation or normal-green inversion was applied. The packed channels exactly equal their separately resampled source images. Raw source PNG bytes and map hashes are retained. The original height map remains source evidence and does not displace CAD geometry.

## Sergej Majboroda / Studio Small 08, Poly Haven

**“Studio Small 08” by Sergej Majboroda, Poly Haven, CC0 1.0.**

- [Asset source](https://polyhaven.com/a/studio_small_08)
- [Poly Haven license](https://polyhaven.com/license)
- [Retained source and conversion record](studio/studio_small_08-source.json)

This asset is a photographed HDR studio panorama. Runtime changes: linear Radiance HDR decoding, 2 × 2 area reduction from 2048 × 1024 to 1024 × 512, bottom-up float32 RGBA storage, and gzip compression. Runtime radiance is retained without baked exposure or tone mapping. The renderer supplies its orientation and image-based lighting settings.
