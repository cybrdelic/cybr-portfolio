"""Explicit native OptiX backend; unsupported features fail, never fall back."""
from pathlib import Path
import json
import subprocess
from . import Scene


def render_optix(scene, output, *, executable, spp=None, bands=None, size=None,
                 resume=None, tile=8192, checkpoint_every=8):
    """Render on a physical NVIDIA GPU using CYBR LIGHT spectral transport.

    The executable and adjacent device.ptx are built separately. Progress is
    written atomically to <output>-progress.json once per completed packet.
    Checkpoints are renderer-specific, not compatible with native CPU films.
    """
    output=Path(output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
    path=scene.save(output.with_suffix('.cys')) if isinstance(scene,Scene) else Path(scene).resolve()
    command=[str(Path(executable).resolve()),'--scene',str(path),'--out',str(output),
             '--tile',str(tile),'--checkpoint-every',str(checkpoint_every)]
    for key,value in (('--spp',spp),('--bands',bands),('--resume',resume)):
        if value is not None:command.extend((key,str(value)))
    if size is not None:command.extend(('--size',str(size[0]),str(size[1])))
    with output.with_suffix('.log').open('w') as log:
        subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True)
    report=json.loads(output.with_suffix('.json').read_text())
    if not report.get('gpu_execution'):raise RuntimeError('No physical GPU execution receipt')
    return report
