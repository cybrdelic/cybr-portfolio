# Pipelines and rebuilding

This is a working graphics research archive, not a packaged cross-platform
simulation application. The static player runs immediately; production render
scripts expect their inputs, output folders, dependencies and renderer settings.
Earlier experiments are retained so decisions and failures can be inspected.

## Current delivery

The current output lives in
`outputs/cybrdelic-type/elements/motion/bending/sigils/02/`.
`work/element-motion/sigil-02-active-elements/README.md` contains the detailed
delivery notes, limitations and validation receipts for the latest four films.

| Material | Main sources | Method |
| --- | --- | --- |
| Fire | `sigil_02_source.py`, `sigil_02_build_v2.py`, `sigil_02_fire_v2.py` | Original sigil source fields, fuel transport, reaction, cooling, buoyancy and custom volume rendering |
| Air | `sigil_02_air_v2.py` | 3D gas transport and turbulent smoke rendering |
| Earth | `sigil_02_ground_earth_build.py`, `sigil_02_ground_earth_render.py`, later arrival revisions | Guided fragments followed by native rigid collisions and floor settling |
| Water | `sigil_02_active_water.mjs`, `sigil_02_active_mesh.py`, `sigil_02_active_water_render.py` | Native APIC/FLIP, pressure projection, reconstructed liquid surface, Cycles optics |
| Ice / lava | `sigil_02_new_materials.py`, `sigil_02_atmosphere.py` | Fractured solids, Bullet release, advected gas, material-specific surface rendering |
| Lightning | `sigil_02_electric_tree_export.py`, `sigil_02_atmosphere.py`, `sigil_02_new_materials.py` | Retained Laplacian-growth trees, pulse timing, channel lights and volumetric clouds |
| Telekinesis | `sigil_02_source.py`, `sigil_02_coherent_earth_build.py`, `sigil_02_telekinetic_contours.py`, `telekinesis_02_render_v2.py` | Approved 02 rebuilt as 174 closed pieces; SDF-derived pressure contours and fragment-bound seams hold the shape before its directional cast |

All filenames in the table are relative to `work/element-motion/`.

## What is simulated and what is authored

**Water.** The latest forward segment evolves 138,022 parcels for 240 frames.
Gravity stays active; bounded external forces recover sagging water toward the
mark. A deterministic subset of parcels is exempted from upward recovery so
small droplets can fall. Reconstruction accounts for both the main surface
and isolated liquid clusters. The final edit reuses the previous 3.4-second
opening and overlaps the new segment by 0.2 seconds. It is not one uninterrupted
forward solve.

**Earth, ice and lava.** Assembly and suspension use authored rigid trajectories.
Released fragments collide with each other and the floor. Ice and lava each
use 174 fragments; their gas emission follows the fragment transforms. Ice has
transmission, absorption and surface detail. Lava uses displaced basalt crust
and emissive interior seams. These do not solve latent heat, freezing, melting,
viscous liquid lava or a coupled phase-changing MPM system.

**Telekinesis.** The 02 geometry and its negative spaces come from the same
approved artwork as the other films. Each of its 174 closed fragments follows
an authored force trajectory through assembly, suspension and a directional
cast. The visible field is derived from offsets of the approved source signed-
distance field; animated seams and short channels stay bound to the fragments.
This is an authored visual effect, not a rigid-body force-field simulation.

**Atmosphere.** The current gas pipeline uses semi-Lagrangian advection,
buoyancy, dissipation and FFT pressure projection with absorbing edges.
Density is stored in atlases and sampled as a 3D volume. Emission and small-scale
forcing remain authored. The atlas is a storage representation, not a flat smoke overlay.

**Electricity.** The current channels are branching 3D growth trees with trunk,
fork and fine-branch widths. Irregular pulses illuminate the accompanying gas.
This is a visual discharge model, without a calibrated electromagnetic/plasma solve.

## Environment

The final production machine used Windows, Python 3.12, Node.js 20+, Blender
4.5.3 LTS and an NVIDIA RTX 4060 Laptop GPU. Full-resolution renders use OptiX
where configured. Rendering has not been validated on every operating system.

Typical Python packages vary by pipeline:

```sh
python -m pip install numpy scipy pillow opencv-python scikit-image shapely fonttools brotli
```

Fire/gas scripts additionally require a compatible PyTorch installation.
Historical research includes Mitsuba, Warp and MPM experiments with separate
environment requirements; these are not needed to play the delivered movies.
Install FFmpeg/ffprobe on PATH. Blender scripts use Blender's Python environment.

Several historical scripts retain absolute Windows executable paths and local
cache references. Set these for your machine before running them. Do not run
the whole directory indiscriminately: some builders rewrite generated scripts,
some experiments were rejected, and some queues wait for review receipts.

## Rebuilding the active materials

1. Restore all retained inputs with `python scripts/fetch_assets.py --all`.
2. Read the active-elements README and inspect the relevant script's input paths.
3. Select a fresh output revision. Existing simulation and render receipts are
   deliberately protected against accidental replacement or cache reuse.
4. Run the CPU preparation and small representative frames first. Check finite
   state, volume, containment, silhouettes and contact before a full render.
5. Run one GPU render at a time. The laptop production queue became slower with
   concurrent jobs. Full simulations need substantially more storage than the
   published checkout.
6. Encode, fully decode, inspect motion and verify playback before changing the
   player. A numerical audit alone does not establish visual quality.

`sigil_02_active_water_run.py` orchestrates the native water solve, mesh
reconstruction and Cycles render. `sigil_02_active_material_queue.py` consumes
review gates and queues ice/lava/lightning rendering. The final gas caches and
frames are rebuildable and intentionally absent from the publication. Retained
inputs and source code do not mean the full render can resume without rebuilding
those caches.

The earlier `sigil_02_native_volume_experiment.py` and
`sigil_02_electric_paths.py` are retained experiments, not the adopted final
electricity pipeline.

## Fonts and showcase

Font rebuild instructions are in
`outputs/cybrdelic-type/typefaces/README.md`. The source includes outline JSON,
OpenType features and the Python builders.

`python scripts/build_showcase.py` builds the README GIF from the seven existing
MP4s using CPU FFmpeg and Pillow. It writes a source/timing receipt alongside
the GIF. It does not change the films or invoke a simulation.
