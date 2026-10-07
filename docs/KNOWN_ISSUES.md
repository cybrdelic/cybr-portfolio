# Known issues and limits

## Existing source limitations

- Hybrid raster/native-event optical modes approximate transport; they do not
  establish full spectral/global transport or photographic parity.
- Older cartridge/targeted-bake paths retain staging/incomplete-coverage notes.
  Their original source status is not promoted by this cleanup.
- Older full-bake and source-regeneration scripts reference raw geometry,
  environments and renderer inputs outside this package. The bundled current
  browser assets run without regenerating them; complete regeneration is not
  claimed from this subset alone.
- Four unused historical Soldier model exports are intentionally absent from
  public distribution. Rebuilding that superseded export needs separately
  held private inputs. Current pages, Inspector, films and stills are retained.
- Julio Sillet's retired material record identifies CC-BY without a version.
  Its attribution and original record are preserved; a version is not inferred.

## Packaging issues found and corrected

Six existing Notes dependencies were initially omitted with the accumulated
output history; only those linked records/contact images were restored. Three
small optical test fixtures moved to `tests/fixtures/native-optics/`, with
test-only URL updates. Two playback tests now create their generated proof
directory before writing, so tests work on a fresh package. These were caught
in local staging and are not reported as pre-existing rendering defects.

## Browser review results and remaining limits

The default desktop main workflow passed the observed six-chapter traversal,
dialog controls, keyboard End/Plate reset and Notes checks against the frozen
baseline. The emulated reduced-motion mobile view loaded without overflow and
matched its screenshot. Main runtime source was unchanged in that publication-baseline comparison.
The later mobile/startup update is documented separately in
[MOBILE_STARTUP.md](MOBILE_STARTUP.md); native Intel viewport acceptance passed
with the documented startup/refinement limits. Physical Android and current
cold-network acceptance remain unverified. See the
[exact comparison](BROWSER_COMPARISON.md) for images, states and counts.

Both baseline and staged runs produced WebGL texture-storage/copy warnings.
The missing favicon and a cold-baseline THREE X4000 shader warning are
documented as existing observations. No uncaught JavaScript page error was
recorded. Existing approximate transparent-optics behavior remains visible.

Live water/fire clocks were not synchronized for pixel comparison. Archive
and film screenshot pairs had different scroll positions; a follow-up capture
helper timed out and was not rerun after releasing the hardware slot. Their
normalized visual acceptance remains incomplete. Optional WebGPU quality
mode and physical mobile devices were not tested in that baseline review.
The later native mobile-viewport tap tour passed as recorded in
[MOBILE_STARTUP.md](MOBILE_STARTUP.md).
The new staged progress recording was fully decoded and visually inspected
at representative points; it is evidence, not certification of full art
quality or performance.

The current Inspector contains licensed mannequin geometry and mixed,
source-labeled motion. Its metadata credits and personal paths were corrected
for publication; geometry and animation were preserved. Legacy rendered
evidence remains separate from the omitted historical model data; see
[exact asset usage](COMBAT_ASSET_SCOPE.md).

## Current mobile performance limits

The native update presents complete GEO early, but full-model readiness did not
improve in the local Intel comparison. Full-scene memory remains high; native
reflection refinement took 67.08 s with a maximum timed step of 6.46 s. An early
Close action once took 1.11 s during mesh setup, then passed at 426 ms in the
follow-up. SwiftShader and synthesized-scroll diagnostics retain separate
failures. Their exact scope and native passes are documented in
[MOBILE_STARTUP.md](MOBILE_STARTUP.md); physical Android, optional WebGPU and
current cold-network performance are not certified.
