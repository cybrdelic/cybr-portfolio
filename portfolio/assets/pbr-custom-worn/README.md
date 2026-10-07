# Original CYBR microstructure wear

The current `microstructure-v6-sparse` revision adds thin greasy contact, resolved fingerprint ridges, fine abrasion and sparse crevice deposits to the preserved [clean machining textures](../pbr-custom/README.md). Brushing, centered lathe grooves and diamond profiles remain a separate fine layer. No downloaded material bytes enter these maps.

Each alloy has an authored **128 × 128 mm**, **2048 × 2048** macro domain. Broad contact changes reflection primarily through roughness; pure-film color coverage is at most **0.035**. Tiny deposit cores have matched color and opaque-material coverage. Large solid patch silhouettes are absent from the source recipe. Numerical verification reports both the whole tile and its central 64 mm region, including the largest connected deposit extent.

## Alloy layers

| Set | Sparse deposits | Authored individual pit depth |
| --- | --- | --- |
| [AluminumWear](AluminumWear/source.json) | Neutral dirt/aluminum oxide; no iron-rust image/color | 0.4–2 µm |
| [SteelWear](SteelWear/source.json) | Small granular dirt/iron-oxide clusters; original generated oxide color only | 1–4 µm |
| [BronzeWear](BronzeWear/source.json) | Sparse dark dirt and independent brown/green patina; no iron-rust image/color | 0.6–2.8 µm |

The original contamination image provides explicit coverage data. Local contrast separation retains naturally broken ridge contacts, scaled to **14–16 mm width × 18–20 mm length**. Contact stamps are placed on the roughly 30 mm radial band of the centered source chart so a central hole does not hide every print. These footprints are authoring values; the generated source is not a measured human print.

Independent abrasion cuts have 0.08–0.14 mm Gaussian width sigma, 1.2–7.5 mm length and **0.5–2.5 µm** depth. Sparse smooth pits have **no added raised rim**. Both fields are numerical millimeter geometry; no generated-image brightness becomes height. Their summed height generates the OpenGL tangent normal. Smaller unresolved machining detail remains in the clean fine maps rather than being aliased into this macro layer.

## Runtime channels and response

| File | Encoding | Meaning |
| --- | --- | --- |
| `runtime/color-coverage.webp` | RGBA; RGB sRGB, A linear | Target contaminant/darkened-metal color. Pure oil A ≤ 0.035; deposit color alpha follows G coverage. |
| `runtime/surface.webp` | RGBA linear data | R target roughness; G opaque deposit coverage; B thin-film/fingerprint coverage; A 255 reserved. B is suppressed by `1-G` under deposits. |
| `runtime/normal.webp` | RGB linear data | OpenGL +Y normal from independent abrasion + pit height, combined with the clean machining normal at physical normal scale `[1,1]`. |

The current renderer uses **wear strength 1 for all three alloys**, with the amount controlled by the authored coverage. A G=1 core receives a dielectric response: metalness and anisotropy become zero, and its target color is fully covered. This deposit-core response is independent of a nonzero global film strength; setting strength 0 disables wear. Thin B film changes roughness while retaining substrate metalness. A's small film-color contribution is suppressed under raw G so clearing a deposit cannot leave a colored metallic fringe.

Pure film targets about 0.12–0.32 roughness, with print contact lowering roughness and abrasion varying it locally. Dirt targets 0.57–0.76; oxide targets 0.70–0.90. R outside all layer coverage is an ignored fallback and must not be applied globally.

The renderer protects only deposits at sharp rims over **0.05–0.15 mm**; thin contact films remain to the edge. Cylinders use the nearest positive integer number of whole macro tiles around their actual outer circumference. Faces and planes retain physical millimeter charts. Thus the exact barrel tile width is circumference divided by that integer, close to 128 mm where geometry allows; it is not always exactly the source's nominal size. Part-local phase keeps the wear attached through motion.

These maps provide **optical normal relief**, not CAD displacement. Scales, colors, roughness and depths are authored values, not measured reflectance or scanned damage. Contacts are diagnostic data/composites, not PBR renders or proof of motion quality.

## Original generated inputs

Both built-in OpenAI ImageGen originals are **1254 × 1254**. Their semantic coverage or color is resampled for 2K runtime. Independent abrasion/pit fields are authored natively at 2K.

- [Contamination original PNG](source-appearance/contamination-imagegen.png) · [exact prompt](source-appearance/contamination-prompt.txt)
- [Steel oxide appearance original PNG](source-appearance/rust-imagegen.png) · [exact prompt](source-appearance/rust-prompt.txt)
- [Generation receipt, original filenames and PNG/prompt hashes](source-appearance/generation.json)
- [Source notice](NOTICE.md)

Only SteelWear reads the iron-oxide appearance for color. Aluminum and bronze deposit colors are independent palettes. Lighting provenance is maintained separately from material authorship.

## Editable sources and checks

Every set retains `source/recipe.json`, film/fingerprint/abrasion/dirt/oxide/opaque/roughness/coverage PNGs and a 16-bit `pit-height.png`. That legacy filename contains the **combined abrasion and pit height**; its millimeter offset/range is explicit in the recipe. Float NPZ sources separately retain both height components, the film before deposit suppression, and all coverage fields.

- [Authoring pipeline](../../output/geo-working/pbr-custom-worn/author-wear.py)
- [Float source fields](../../output/geo-working/pbr-custom-worn/fields/)
- [Whole-map contact](../../output/geo-working/pbr-custom-worn/wear-contact.jpg) · [24 mm microstructure details](../../output/geo-working/pbr-custom-worn/wear-detail.jpg)
- [Executed numerical checks](../../output/geo-working/pbr-custom-worn/verification.json) · [test log](../../output/geo-working/pbr-custom-worn/material-tests.txt)
- [Source/runtime hashes](../../output/geo-working/pbr-custom-worn/source-hashes.json) · [physical recipe notes](../../output/geo-working/pbr-custom-worn/SOURCE-RECIPES.md)

Rebuild with `python portfolio/output/geo-working/pbr-custom-worn/author-wear.py`; verify with `python portfolio/output/geo-working/pbr-custom-worn/verify.py`. The authoring script imports mathematical helpers from the clean pipeline, reads no clean texture pixels and writes no clean files. Earlier rejected maps/recipes are retained under the output folder's `history/v4-camouflage` and `history/v5-candidate2` for comparison.
