# CYBR Song — recovered Lacuna engine

Recovered from the original `CYBR_Lacuna_Tone_Source_and_Samples.zip`, not reconstructed from a description. Archive SHA-256: `3c7eeb199fc4608b74587e5be7914d01a64d400a63aca7c3e5f07f2d6d0d00da`.

## Create something new

With Python 3.13, create a virtual environment, install `source/requirements.txt`, then run:

```sh
python source/check_assets.py
python source/new_miniature.py
```

This composes **Lantern Steps**, a new four-bar score, and renders it through the recovered instruments and calibrated mix. `demo-output/` receives lossless FLAC, score/performance JSON and fresh verification. GitHub Actions runs the same commands and publishes an artifact. Numerical checks do not constitute a listening review.

The freshly generated [Lantern Steps audio](demo-output/lantern-steps.flac), [score](demo-output/score.json) and [measurement report](demo-output/verification.json) are also committed here. The piece has 33 attacks over 17.635 seconds, finite audio and zero clipped samples. Artifact uploads are optional because this account's private Actions storage quota is currently full; rendering failures still fail CI. Original printable score PDFs and guitar tabs are retained in [scores](scores).

Below is the original delivery documentation. Its `video/` and `audio/` links describe generated deliverables, not files included in this source archive. Regenerate them with the original scripts and FFmpeg. Packaged `tests/` reports are historical evidence, not latest CI results. Attribution and licenses remain in `licenses/`.

## Original delivery: Lacuna-tone restoration

This release changes the instrument playback and mix, not the compositions.
Both performances use the Slender Salamander piano and BJAM clean-electric
recordings used in the accepted **Lacuna** revision. **The Orchard Keeps the Rain
is now a clean-electric fingerstyle performance, not an acoustic-guitar repair.**

## Listen

- `video/Velvet_Switchblade_Lacuna_Tone.mp4` — 2:30, synchronized score.
- `video/The_Orchard_Keeps_the_Rain_Lacuna_Tone.mp4` — 2:59, synchronized score.
- `video/Before_After_Loudness_Matched.mp4` — 48-second, same-passage comparison.
- The comparison order is previous tango at 0:00, revised tango at 0:12,
  previous folk at 0:24, revised folk at 0:36. The four lossless comparison
  excerpts measure -23 LUFS each; encoded copies can differ slightly.

The comparison contrasts the **complete production paths**, including their
existing room processing. It is not a dry single-variable experiment. Each
excerpt receives only a constant gain for loudness matching and 5 ms edit fades.
No compressor or limiter is used to force the excerpts to match.

## Actual changes found in the two-genre source

| Setting | Accepted Lacuna | Rejected tango | Rejected folk | This render |
|---|---:|---:|---:|---:|
| Guitar recordings | BJAM electric | BJAM electric | Ella acoustic | BJAM electric, both songs |
| Neck / middle electric blend | 90 / 10 | 84 / 16 | Not applicable | 90 / 10 |
| Electric final low-pass | 5,600 Hz | 6,100 Hz | Acoustic path, 8,700 Hz filter | 5,600 Hz |
| Piano stereo-side multiplier | 0.83 | 0.83 | 0.72 | 0.83 |
| Piano room send coefficient | 0.29 | 0.18 | 0.26 | 0.29 |
| Guitar room send coefficient | 0.25 | 0.15 | 0.20 | 0.25 |

These coefficients describe implementation changes, not a perceptual rating.
Room send coefficients are not percentages of perceived wet loudness.

The older releases also recalculated each instrument's loudness gain on each new
piece. This revision instead measures the approved Lacuna's dry stems once,
through its original processing, and uses those **same fixed instrument gains
on both songs**. There is still one constant whole-song mastering gain to preserve
headroom; there is no limiter, compressor, per-bar normalization, or borrowed
bar-index automation from another composition.

## Separate inherited sampler bug repaired

The old guitar mapper contains `if 'ampeg_attack=' in line: continue`. The
publisher supplies a normal and a 100 ms faded version of the same quiet-note
recording; that condition discards the faded contribution, and the old runtime
also ignores the companion velocity-crossfade weight. Quiet notes therefore
retained the full picked transient at a reduced overall volume.

`SoftTouchGuitar` restores a normalized linear-gain blend of those coherent
copies. It does not create a new sample or falsely call filtering a recorded
hammer-on. The actual picked/HPS/muted/harmonic source selection, string damping,
and inherited legato/vibrato behavior remain the Lacuna engine's.

The isolated test on E4 checks velocities 32, 56, 72, and 96. The first 25 ms
changes by -6.38, -2.62, -0.79, and 0.00 dB respectively, while the waveform after
101 ms is bit-identical. This test isolates the envelope correction; it is not
an assessment that the resulting guitar is realistic or preferable.

Reference for linear gain crossfades of phase-aligned material:
https://sfzformat.com/opcodes/xf_velcurve/

Reference for attack envelopes:
https://sfzformat.com/opcodes/ampeg_attack/

## What is deliberately unchanged

The serialized pitches, velocities, onsets, key-off times, actual string releases,
articulations, ties, and tempo maps match the last release. Both scores are
unchanged. The source `compose.py`, accepted `lacuna_engine.py`, and accepted
`piano_sampler.py` are preserved byte-for-byte; hashes are in
`tests/source_integrity.json`.

The videos retain the original synchronized score animation. Their instrument
subtitle and soundtrack are replaced. The guitar MIDI program is updated to
clean electric; generic MIDI playback cannot reproduce this custom sample engine.

## Checks and limits

`tests/validation.json` records complete MP4 decoding, matching duration and note
schedules, finite/unclipped lossless masters, and the isolated attack tests.
The new masters measure approximately -19.30 and -19.21 LUFS, with 4x measured
true peaks at -1.40 and -1.64 dBFS, respectively. Numerical validation is not
independent perceptual listening validation.

The guitar source recordings used by these masters are 22.05 kHz. The piano
recordings are 44.1 kHz. The delivery format is 48 kHz / 24-bit, which does not
invent additional source bandwidth. This remains a scoped sample-based Python
instrument, not a calibrated acoustic physical model or commercial plug-in.

## Reproduce

The source-and-samples archive includes only the recordings required by these
scores and the validation note. It does not include the publishers' entire banks.
Install the versions in `source/requirements.txt` and FFmpeg/ffprobe, then run:

```sh
python source/check_assets.py
python source/restore.py
# Or only one song:
python source/restore.py --piece 1
```

The supplied `source/lacuna_calibration.json` contains the measured fixed gains;
rebuilding the two songs does not require the original Lacuna stems. To
re-measure the reference, supply a directory containing its two dry FLAC stems:

```sh
python source/restore.py --calibrate /path/to/Lacuna_Lossless_Stems
```

The delivered videos reuse the previous release's animation. To reproduce that
specific operation and its A/B comparison, pass the previous release directory:

```sh
python source/finish_media.py --previous /path/to/CYBR_Two_Genres
python source/verify.py
```

The old score engraver and video renderer are retained as source for further
editing; their font dependencies remain external. No font files are packaged.
The video and comparison sources are intentionally not included in the small
source-and-samples archive; the two new videos and comparison are separate
conversation downloads. The lossless bundle contains new masters and dry/wet stems.

## Attribution

Piano recordings: Alexander Holm. Phase alignment and retuning: Signal Experiments.
Guitar recordings and original SFZ mappings: Malaclypse the Younger, BJAM 5.
Their original notices are in `licenses/`. This release does not claim those
recordings as custom-recorded work. Runtime changes, compositions and rendering
are CYBR project work, not endorsements by the recording authors.
