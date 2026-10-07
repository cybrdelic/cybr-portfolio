# Local validation receipt

On 2026-10-07, the isolated staged source passed:

| Check | Observed result | Scope |
| --- | --- | --- |
| Retained Node regressions | 286 passed, 0 failed | Geometry/optics/material/routing/playback logic |
| HTML/media validator | 15 pages, 1,254 references, 0 missing; 9 valid H.264 films | Local file and film metadata integrity |
| Native CMake build | All three Release targets built | Current retained C++ source, MSVC |
| Native numerical/coating checks | 28 numerical + 5 coating passes | CPU transport mathematics |
| Matched native workflow | Exact decoded pixel equality | Actual GEO knurled service band, 1,512 triangles, production scene/renderer/PFM path |

The matched render used the same scene SHA-256
`1efc645a6c3502c97fff956e9d61c6b71b68d4a470f5fc66c6a90852dd5923cf`,
seed `20261006`, 192×128 pixels, 4 samples, 4 bands, depth 5, one CPU thread,
and fixed camera for the preserved binary and rebuilt source.
Decoded pixel SHA-256 for both:
`fc0733e9477a765004cc288951fb06b6bc18288bcfcf6887182eb725ad372895`.
All pixels were finite. The actual preview pixels were inspected.

This small component render is intentionally noisy and does not certify a
full six-module image, material art direction, browser shader compilation or
interactive performance. Raw image/log/proof evidence is kept outside the
public source tree. A subsequent isolated browser review compared the frozen
baseline and staged default main workflow; [exact results](BROWSER_COMPARISON.md)
include shared warnings and incomplete image comparisons. Those separate
browser checks do not expand the representative native-render claim.

The allowlisted local build also passed the same 15-page/1,254-reference/9-film check. Loopback HTTP bytes matched the source for the current entry, geometry, HDR, shader, fire video and water frames 0/54/108. The actual current shared-water playback loader passed forward/back decode at frames 0/54/108/54/0. The retained current fire atlas decoded with software FFmpeg and its pixels were inspected; it is existing asset evidence, not a new browser progress video. Source hash audit compared 163 retained code files: 159 unchanged and four test-only edits, with no runtime changes or credential-pattern flags.

The default desktop browser review exercised all six main chapters, study
dialog controls, keyboard End/Plate reset and Notes. Reduced-motion mobile
viewport readiness/overflow was checked. The newly recorded staged main MP4
was CPU encoded, all 1,856 frames decoded successfully, representative frames
were visually inspected, and the mobile-playable file was saved to Library.
No performance claim, full mobile tap tour, optional WebGPU validation or
normalized archive/film visual acceptance is made.

## Final curated public-source checks

The curated public payload was validated on 2026-10-07 using CPU-only checks.
No further browser or GPU session was started.

| Check | Result |
| --- | --- |
| Retained Node suite | 286 passed, zero failed |
| Page/media closure | 15 pages, 1,254 references, zero missing, nine valid films |
| Extended HTML/static-module closure | 1,407 references, zero missing |
| Source allowlist | 1,489 files; current assets preserved |
| Public Git baseline | Exactly 1,510 files, including documentation/manifests |
| Credential/personal-path scan | Zero flags in the candidate public files |
| Allowlisted build | 1,489 files copied; no runtime asset regeneration |
| Built-package validator | Same 15-page/1,254-reference/nine-film pass |
| Loopback HTTP byte smoke | Current entry, geometry, HDR, shaders, fire and sampled water files matched |
| Inspector invariants | Executable scripts, geometry and non-validation scene data unchanged |
| Optical fixture/recipe invariants | Numeric data unchanged; provenance checksum refreshed |

The Inspector's packed geometry SHA-256 remains
`f4f72a0a98b0ce87032f01b432676d41771823db977ff1145785498698544118`.
Source-manifest SHA-256 after publication curation:
`beccb03118acf38a647a78ea82c19da0f8baee38930e4fb976f4377cfdbd8248`.

An initial restricted Node run could not spawn test workers. The same suite
ran with authorized process permissions; a descriptor provenance checksum
was then refreshed after personal-path normalization, and all 286 tests passed.
The public package excludes three machine-specific Python-environment files
that the older selection had retained, as well as the four approved unused
historical model exports. None was removed from original/private copies.

These are local validation results. No GitHub Actions workflow is configured.
The earlier native/browser results above remain separate and retain their
stated limits. No new deployment, full optical bake or art-quality claim is made.
