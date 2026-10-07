# Historical material trials and live HDR source

Metal 010, Metal 051 A and Julio's diamond metal are retained as **retired material trials**. The current instrument uses original [custom CYBR maps](../pbr-custom/README.md), with no downloaded material inputs. Studio Small 08 remains the separately credited live photographed HDR source. Public credits appear in [Technical records](../../evidence.html#proof-materials). [NOTICE.md](NOTICE.md) retains author, license, source and change notices.

| Asset | Source method | Runtime use | Source record |
| --- | --- | --- | --- |
| Metal 010 / ambientCG | Procedural PBR material | Retired directional brushed-metal trial | [Metal010/source.json](Metal010/source.json) |
| Metal 051 A / ambientCG | Procedural PBR material | Retired circular-face and bronze-tint trial | [Metal051A/source.json](Metal051A/source.json) |
| Metal Knurled 01 03 / Julio Sillet, via MatSynth | Procedural PBR material | Retired knurled and finer-diamond trial | [JulioKnurl/source.json](JulioKnurl/source.json) |
| Studio Small 08 / Sergej Majboroda, Poly Haven | Photographed HDR studio panorama | Image-based illumination and reflections | [studio/studio_small_08-source.json](studio/studio_small_08-source.json) |

## Runtime transformations

Material runtime directories contain `baseColor.webp`, `normal.webp` and `roughness-metallic.webp`. Albedo uses sRGB. Normal, roughness and metallic maps use linear data without a color transfer curve. OpenGL tangent normals have +Y upward. All maps retain a consistent image orientation; no green-channel inversion is applied.

The ambientCG 2K PNGs are decoded to browser-compatible 8-bit channels. Runtime WebP encoding is lossless. Julio's original 4K maps are downsampled to 2K with Lanczos, then encoded as lossless WebP. Roughness is placed in G, metallic in B, and R is constant 255 and unused. Packing is checked against the independently decoded or resampled source grayscale images. There is no roughness remapping. Source files, dimensions and SHA-256 hashes are retained beside the runtime copies.

The Studio Small 08 Radiance HDR is decoded in linear RGB, reduced from 2048 × 1024 to 1024 × 512 with area filtering, and stored as gzip-compressed little-endian float32 RGBA with bottom-up rows. No exposure or tone mapping is baked into those runtime radiance values. Display previews have their own display transform, recorded in the environment receipt.

Native-part profiles choose texture scale, normal strength, anisotropy and color multipliers. The warm bronze appearance is an authored tint of Metal 051 A. Surface relief comes from mapped normals; retained height/displacement maps are not applied to the CAD positions.

## Physical scale

These material sources do not supply measured tile dimensions. Millimeter tile sizes are authored for the native CAD parts.

For Julio's diamond material, image analysis measures 16 full U repeats and 10 full V repeats per source tile. The GEO service-band U tile is `279 / 17 = 16.41176470588235` mm, with a 10 mm V tile. Seventeen complete image tiles close around its 279 mm angular chart. The finer locking-ring tile is 10.4 × 6.5 mm; 26 complete U tiles close around its 270.4 mm chart. Both explicit pairs are recorded in [JulioKnurl/source.json](JulioKnurl/source.json). Circumferential U follows the ring and axial V follows the native cylinder axis.

`runtime/maps.json` files record output paths, hashes, channel layout and conversion evidence. Original source files and the source notices remain available for attribution and comparison.
