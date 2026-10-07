"""Use project-local GPU dependencies with the existing native safety harness."""
import runpy, sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'portfolio/output/elements-bake/vendor'))
script = root / 'cybr-elements/tools/fire-studio/replay-volume-runtime.py'
sys.path.insert(0, str(script.parent))
# Prevent the obsolete vendored copy from shadowing the installed package.
import wgpu, numpy, PIL
sys.argv = [str(script), *sys.argv[1:]]
runpy.run_path(str(script), run_name='__main__')
