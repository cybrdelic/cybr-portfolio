# Source scope and recovery provenance

The source came from the verified two-copy portfolio checkpoint made on
2026-10-06. The C and D copies had 267 byte-identical portfolio code files. The
D copy supplied the current complete runtime tree and the image absent from
the C copy, `Observatory_IV_unfiltered.png`. Their distinct output histories
remain in separate recovery copies; neither original was reconciled in place.

The backup contains 21,597 enumerated readable files, 10,037,555,693 bytes,
with independent source/destination SHA-256 verification and no mismatch.
Fifteen inaccessible C Python vendor directories are disclosed exclusions,
outside that readable denominator. Their accessible D equivalents were
preserved; no permissions were bypassed.

Verified summary SHA-256:
`61ee2c8f2858e84d365bcc1a8e40bba918088bd71204c137249b0ce6c5bbfb2c`.

`source-manifest.json` records original file hashes. `cleanup-edits.json`
records only path/output-directory changes in tests and removal of redundant
native binaries; runtime source hashes remain unchanged. `source-exclusions.json`
summarizes omitted generated/cache/iteration categories. The full recovery
inventory and selection plan are held outside this project.

Explicit sibling dependencies retain the original directory names so that
runtime imports, shaders, media and the native CMake wrapper resolve. Selected
sibling directories are not claimed as full exports of those projects. There
is no umbrella Git history imported into this local tree; the original unborn
repository's loose objects remain in its verified backup.

Retained historical notes describe past revisions and may refer to unbundled
raw workspaces or screenshots. They are source history, not current test
results. Current checks and outstanding acceptance work are stated separately.

The public manifest now omits four unused historical model exports and adds
the required motion notice. Prepublication hashes and provenance-only changes
are recorded separately; see [public boundary](PUBLICATION.md).
