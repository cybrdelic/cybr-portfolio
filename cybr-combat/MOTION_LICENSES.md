# Current motion and graphical asset provenance

This notice accompanies `CONTACT_Inspector.html` and `preview/scene.json`.
Graphical assets, animation sources, generated outputs and software have
separate terms. No single license is assigned to this mixed payload.

## Current mannequin

The current male/female body, shirt and shorts are MakeHuman CC0 graphical
asset derivatives, rebound using Quaternius CC0 rest-frame references, with
CYBR contributions dedicated to CC0 1.0. See [MANNEQUIN_LICENSE](MANNEQUIN_LICENSE.md).
MakeHuman application code is separately AGPL; it is not included in the builder.

Sources: [MakeHuman asset license](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.ASSETS.md),
[MakeHuman license explanation](https://static.makehumancommunity.org/about/license.html),
[Quaternius library](https://quaternius.com/packs/universalanimationlibrary.html).

## Authored and CC0 motion

Original contact/run/shuttle and pose-guided studies retain their CYBR source
labels. Reference and retargeted Quaternius Universal Animation Library 1/2
Standard motion is CC0 1.0; no paid pack is included.
[Library 1](https://quaternius.com/packs/universalanimationlibrary.html),
[Library 2](https://quaternius.com/packs/universalanimationlibrary2.html).
Masked Character jogging derivatives are credited to RevenantWings and
Quaternius under the source's CC0 terms:
[Masked Character](https://revenantwings.itch.io/maskedcharacter).

## NVIDIA Kimodo generated motion

The labeled Kimodo takes contain generated motion output and CYBR retargeting,
not model weights. The NVIDIA Open Model License says outputs are not
Derivative Models and NVIDIA claims no ownership in outputs. This notice
preserves that provenance and does not relabel those outputs CC0.
[Exact model license](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1/blob/main/LICENSE),
[Model card](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1).

## Yle Archives video-derived landmark studies — CC BY 3.0

Yle Archives / Elävä arkisto is credited for the following 1947 source films:

- **Boxing Match Gunnar Bärlund vs Denis Juliani at Helsinki, 3 June 1947**.
  [Source film and publisher attribution](https://commons.wikimedia.org/wiki/File:Boxing_Match_Gunnar_B%C3%A4rlund_vs_Denis_Juliani_at_Helsinki_3.6.1947.webm).
  Derived data: `assets/motion-sources/video/barlund-footwork-2976-3068.json`.
- **Boxing Match Yrjö Piitulainen vs Jean Wanes at Helsinki, 30 September 1947**.
  [Source film and publisher attribution](https://commons.wikimedia.org/wiki/File:Boxing_Match_Yrj%C3%B6_Piitulainen_vs_Jean_Wanes_at_Helsinki_30.9.1947.webm).
  Derived data: `assets/motion-sources/video/piitulainen-footwork-722-73.json`.

Both are [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
CYBR cropped the references, estimated pose landmarks, selected short studies
and partially retargeted the motion. Source hashes, film properties, credit,
URLs and changes are retained in the landmark JSONs and embedded Inspector
validation metadata. Personal machine paths were normalized for publication.
These credits do not imply endorsement by Yle. The source films are not bundled.

## Software and legacy rendered evidence

The existing software notices remain separate. Legacy armored Combat films
and stills are rendered evidence, distinct from the current mannequin.
Their source and publication boundary are recorded in
[Combat asset scope](../docs/COMBAT_ASSET_SCOPE.md).
