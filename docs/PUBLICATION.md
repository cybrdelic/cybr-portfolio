# Public source boundary

The public package contains the frozen current laptop portfolio and its
selected sibling dependencies, preserving original relative URLs. The main
entry remains `portfolio/index.html` with `instrument-3d.js?v=elements-shared-4`.
No site is deployed. Complete original copies and verified recovery snapshots
remain private and untouched.

## Approved omissions

The following unused historical exports under `portfolio/assets/display-modules/`
are omitted from every public commit: `combat.json`, `combat.bin.gz`,
`combat-3.webp`, and `cybr-combat-cartridge.glb`. Exact original SHA-256 values
are in [publication-exclusions.json](publication-exclusions.json).
They contain old Soldier model/texture data, not rendered evidence. Active
pages and query variants do not load them. The current workshop loads
`combat-impact-cloth-v1` and exports its current visible assembly.

The historical `portfolio/instrument/build_display_modules.py` builder uses
an older private physical-animation-proof scene/geometry/textures. Those
optional inputs are not included, fetched or redistributed by installation.
Its old `combat` export and the static historical GLB are not public deliverables.
Source and historical receipts remain for traceability. Current assets are
bundled; the default build copies the validated source allowlist.

## Preservation and metadata cleanup

Current main HTML/JS/CSS, geometry, motion frames, original rendered films and
stills remain byte-identical to the curated local snapshot. The Inspector's
validation provenance and source-credit link changed; its packed geometry,
mesh/material/animation data and executable playback/rendering code did not.
Personal machine paths in eight provenance files were converted to portable
source paths or explicitly private source references. No secret is introduced
and no image or model is generated for this publication.

The source manifest preserves prepublication hashes for changed metadata.
Original checkpoint summary SHA-256:
`61ee2c8f2858e84d365bcc1a8e40bba918088bd71204c137249b0ce6c5bbfb2c`.
Prepublication source manifest SHA-256:
`89b1206b8a85c733f915ab5df90128509c4a5cef68ff37c8fa4032bc42cc7129`.
See [source scope](SOURCE_SCOPE.md), [cleanup edits](cleanup-edits.json),
[publication edits](publication-edits.json), and [license inventory](LICENSE_INVENTORY.md).

## History and validation

The first public commit is the curated, licensed source baseline; it does not
contain uncertain model exports or personal machine paths. Subsequent cleanup
documentation and validation are reviewable separately. The original umbrella
repository had an unborn branch; no private umbrella history is imported.

Existing defects and earlier browser/native evidence are retained in
[known issues](KNOWN_ISSUES.md), [validation](VALIDATION.md), and
[browser comparison](BROWSER_COMPARISON.md). Publication checks use CPU tests,
source/asset closure, HTTP byte smoke and allowlisted local build. No additional
browser or GPU work is required or claimed.

## Published baseline and review history

The public source baseline is commit
`33872f4e30dd9124c7cbecf56e7d2382c3a7a8f0` in
[cybrdelic/cybr-portfolio](https://github.com/cybrdelic/cybr-portfolio).
It contains exactly 1,510 approved files. All privacy, license-boundary and
required attribution changes were made before this first public commit,
preventing uncertain exports or personal paths from entering Git history.

The cleanup validation follow-up changes only this document, the validation
receipt and their entries in the public-file manifest. It is offered as a
separate draft PR for parent review and merge. The source/asset tree remains
the validated baseline. No GitHub Pages site is enabled or deployed.

Three machine-specific Python-environment files were also excluded from the
candidate. Their original hashes are recorded separately in
`publication-exclusions.json`; private snapshots remain intact.
