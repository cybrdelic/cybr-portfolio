# Custom material authorship and source status

## Current material maps

**BrushedMetal, LatheMetal, DiamondKnurl and DiamondEtch — original CYBR materials, made for the CYBR portfolio instrument.**

Albedo appearance was generated with OpenAI ImageGen from the project's original prompts. The three 1254-square PNG originals, prompts and hashes are retained in `source-appearance/`. Deterministic local numerical authoring independently defines physical height, OpenGL normal, roughness, fine cavity and metallic maps. Each material has `downloadedInputs: []`; no downloaded material bytes are used in these sets.

The machining-v2 revision retains the original image inputs and replaces the numerical recipes with resolved variable tool cuts, finite abrasive/finishing passes, multi-scale roughness and softer diamond valleys/crowns. Runtime transformations include 2K albedo resizing, bounded mean-preserving reflectance detail, periodic edge correction, independent scratch-mask modulation, direct millimeter-height normal derivation, cavity/roughness/metallic channel packing and lossless WebP encoding. Physical dimensions, micron relief, roughness and reflectance targets are authored design parameters. Cavity is a local valley-coverage approximation; no scene lighting is baked into it. Height is independent of AI appearance brightness. The original CAD is shaded with normal relief rather than displaced by the height maps.

The subsequent machining-v3-refined adjustment reduces only the coarse roughness contribution on brushed/lathe. Height, normal, appearance, cavity and diamond map bytes are retained. Previous fine-v1 and machining-v2 outputs remain in the authoring history with hashes. Per-material source receipts and reproducible recipes are retained beside each runtime directory. This notice identifies original project authorship; it does not relicense the project's custom work under a third-party material-library license.

## Retired downloaded material trials

Earlier ambientCG **Metal 010** and **Metal 051 A** (CC0 1.0), and **Metal Knurled 01 03** by **Julio Sillet** (CC-BY, version unspecified in MatSynth's record), are retained as historical trials under `../pbr-metal/`. They are inactive in the current custom material loader. Full source attribution, original bytes, licenses and transformation records remain in [the historical notice](../pbr-metal/NOTICE.md). MatSynth is by Giuseppe Vecchio and Valentin Deschaintre.

## Separate live lighting source

**“Studio Small 08” by Sergej Majboroda, Poly Haven, CC0 1.0**, is the photographed HDR default illumination source. It is separate from the custom material maps. Original authored studio radiance remains available with `?pbr-env=authored`.

- [Asset source](https://polyhaven.com/a/studio_small_08)
- [Poly Haven license](https://polyhaven.com/license)
- [Retained capture/conversion record](../pbr-metal/studio/studio_small_08-source.json)

The HDR conversion preserves linear radiance while reducing it to 1024 × 512 float32 RGBA and gzip storage. Source and conversion hashes remain recorded; no exposure or tone mapping is baked into that runtime environment.
