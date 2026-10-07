from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'cybr-geo/src'))
from mechanism_lab.v9 import _read_pfm,_save_png
folder=Path(sys.argv[1]);_save_png(_read_pfm(folder/'beauty-only.pfm'),folder/'beauty-only.png',1.04)
print(str(folder/'beauty-only.png'))
