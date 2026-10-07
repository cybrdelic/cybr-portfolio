# Combat assets and route usage

The current Inspector and model packages, rendered films and stills remain in
the public source tree. Four unused historical Soldier model exports are
omitted from every public commit, with complete private snapshots retained.

## Current packed mannequin and motion

CPU parsing confirmed that `CONTACT_Inspector.html` embeds the current
male/female body/shirt/shorts plus a floor, with no textures or helmet mesh.
Its geometry is byte-identical to `preview/geometry.bin`: 27,934,752 bytes,
SHA-256 `f4f72a0a98b0ce87032f01b432676d41771823db977ff1145785498698544118`.
Buffer references cover the complete geometry with no dormant legacy data.
The three mannequin instrument packages have the same current mesh topology.
The `legacy` instrument geometry is original mechanical CAD.

The old inventory incorrectly inferred helmet data from dormant renderer
code names. Parsed mesh/buffer data supersedes that inference. The Inspector
contains 3,837 frames; geometry, frames, playback rig and materials are preserved.
Publication edits change validation provenance and add a motion-credit link.
[Current motion credits](../cybr-combat/MOTION_LICENSES.md) distinguish CC0
graphical assets/reference motion, Kimodo generated outputs and CC BY 3.0
Yle-derived landmark studies. No blanket license is assigned.

## Historical rendered evidence and model boundary

The retained `visual_asset_sources.json` receipt records the exact official
Three.js Soldier URL/hash, Khronos SciFiHelmet sources and Poly Haven floor
sources. Original raw model files are no longer at the receipt destinations;
the receipt and retained derived scene identify lineage without claiming a
new raw-source rehash. Receipt SHA-256:
`aa3fa7109d38a982a252b41b1098b608c295f3babb45a1ab64b6e3bf08577c15`.

[Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
permits rendered creative-project illustrations and films.
[Adobe terms, section 3.6](https://www.adobe.com/legal/terms.html) distinguish
embedded end-use content from standalone asset distribution. Four unused
historical model exports have therefore been omitted as the approved package
boundary, rather than replacing visible legacy imagery. Exact original hashes
are in [publication exclusions](publication-exclusions.json).

`combat-3.webp` is the Soldier body diffuse texture. Retained `combat-4/5.webp`
are Poly Haven floor maps; `combat-7/8/9.webp` are SciFiHelmet maps. All six
were reproduced byte-for-byte in memory from retained source PNGs using the
historical builder. [Poly Haven terms](https://polyhaven.com/license) and
[Khronos helmet attribution](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/SciFiHelmet/README.md)
identify those separate graphical sources as CC0. They are texture maps,
not rendered thumbnails.

The legacy rendered inventory contains four films and 50 stills: 20 original
PNGs, their 20 optimized WebPs, and 10 film-derived JPG frames. The earlier
inventory omitted 18 optimized WebPs. Mechanical instrument Combat thumbnails
are original CAD evidence and are not Soldier imagery. Historical audit JSONs
contain measurements/statistics, not reusable model geometry.

## Exact retained page references

| File | Page(s) | Usage |
| --- | --- | --- |
| `cybr-combat/CONTACT_Inspector.html` | `combat.html` | interactive current mannequin |
| `cybr-combat/THIRD_PARTY_NOTICES.md` | `combat.html`, `evidence.html` | source/provenance measurements |
| `cybr-combat/archive/source-led-2026-09-22/evidence/audit_60hz.json` | `combat.html`, `evidence.html` | source/provenance measurements |
| `cybr-combat/archive/source-led-2026-09-22/evidence/export_geometry_step1.json` | `combat.html`, `evidence.html` | source/provenance measurements |
| `cybr-combat/demo-output/frames/frame_0163.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/frames/frame_0173.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/frames/frame_0178.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/frames/frame_0186.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/frames/frame_0221.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/frames/frame_0233.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/frames/frame_0240.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0040_front.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0044_side.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0194_side.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0205_front.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0411_front.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0415_side.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/inspector/0421_rear.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/side-leap-study.capture.json` | `combat.html`, `evidence.html` | source/provenance measurements |
| `cybr-combat/demo-output/side-leap-study.mp4` | `combat.html` | rendered film |
| `cybr-combat/demo-output/workbench/combat.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/workbench/counter-contact.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/workbench/counter-study.mp4` | `combat.html` | rendered film |
| `cybr-combat/demo-output/workbench/desktop.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/workbench/mobile.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/workbench/pose-snapshot.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/workbench/silhouette.png` | `combat.html`, `work.html` | rendered still |
| `cybr-combat/demo-output/workbench/verification.json` | `combat.html`, `evidence.html` | source/provenance measurements |
| `portfolio/assets/089d58b12adc.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/0b096bef52fd.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/145cbaccf3f3.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/1de0a62ca170.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/2c568ae1d6f4.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/38615fb85c05.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/42a50bdda4d4.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/45097ceaf46c.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/5c6667606d37.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/6b7007d63808.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/772ea430c2b2.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/8a25d2eeee53.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/8e589fc03646.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/b445a0de29e6.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/c04e563177c3.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/cf523fc378c3.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/d54fe3f7d600.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/db2c6c2efe67.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/e14d549cd069.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/eb3c63876df3.webp` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/play-combat-counter-study.mp4` | `combat.html` | rendered film |
| `portfolio/assets/play-combat-side-leap-study.mp4` | `combat.html`, `work.html` | rendered film |
| `portfolio/assets/sequence-combat-counter-study-0.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-counter-study-1.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-counter-study-2.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-counter-study-3.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-counter-study-4.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-side-leap-study-0.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-side-leap-study-1.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-side-leap-study-2.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-side-leap-study-3.jpg` | `combat.html`, `work.html` | rendered still |
| `portfolio/assets/sequence-combat-side-leap-study-4.jpg` | `combat.html`, `work.html` | rendered still |

Current offline dependencies retain `preview/scene.json`, `geometry.bin`,
`cloth.js` and `playback.js`. Historical private inputs for the superseded
builder are documented in [publication boundary](PUBLICATION.md).
