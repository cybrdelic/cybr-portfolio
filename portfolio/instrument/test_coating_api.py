from pathlib import Path
import sys,unittest,tempfile
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from cybrlight import Scene
from cybrlight.workflow import validate_scene,UnsupportedFeatureError
from cybrlight.portable import pack_scene

class CoatingContract(unittest.TestCase):
    def scene(self):
        s=Scene('coating contract');m=s.material(type='glass',film_nm=380,film_ior=2.8,film_gradient=(0,140,90))
        s.sphere((0,0,0),1,m);return s
    def test_native_serialization(self):
        s=self.scene()
        with tempfile.TemporaryDirectory(dir='D:/CYBR-build/exploded-instrument/temp') as folder:
            path=s.save(Path(folder)/'coating.cys')
            self.assertIn('thin_film 0 380',path.read_text())
    def test_polarized_is_explicitly_unsupported(self):
        s=self.scene();s.settings.polarized=True
        with self.assertRaises(UnsupportedFeatureError):validate_scene(s)
    def test_portable_does_not_silently_drop_coating(self):
        with self.assertRaisesRegex(UnsupportedFeatureError,'coatings'):pack_scene(self.scene())
    def test_mutated_nonfinite_coating_is_rejected(self):
        s=self.scene();s.materials[0].film_nm=float('nan')
        with self.assertRaises(ValueError):validate_scene(s)
    def test_wrong_material_is_rejected(self):
        with self.assertRaises(ValueError):Scene().material(type='metal',film_nm=300)

if __name__=='__main__':unittest.main()
