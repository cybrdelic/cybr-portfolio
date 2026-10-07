"""Check production material receipts without loading full frame buffers."""
from pathlib import Path
import argparse, hashlib, json
from PIL import Image

def verify(folder, revision='v9'):
    results=[]
    for name in ('geo','light','elements','song','combat','scenes'):
        prefix=folder/'renders'/name/f'{name}-{revision}-800-96spp'
        receipt=json.loads(prefix.with_name(prefix.name+'-bake').with_suffix('.json').read_text())
        report=receipt['native_report']
        assert receipt['finish_profile']=='studio',name
        assert receipt['machining_uv'],name
        assert report['invalid_path_samples']==0,name
        assert report['width']==800 and report['height']==640,name
        assert report['packets_per_pixel']==96 and report['wavelengths_per_packet']==8,name
        sprite=prefix.with_suffix('.webp')
        assert hashlib.sha256(sprite.read_bytes()).hexdigest()==receipt['sha256'],name
        with Image.open(sprite) as image:
            assert image.mode=='RGBA' and image.size==(800,640),name
            assert image.getchannel('A').getextrema()==(0,255),name
        results.append(dict(name=name,bytes=receipt['browser_bytes'],
            render_seconds=report['render_seconds'],invalid_path_samples=0,
            parts=receipt['parts'],triangles=receipt['triangles']))
    return dict(revision=revision,passed=True,modules=results)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--folder',type=Path,required=True)
    parser.add_argument('--revision',default='v9')
    args=parser.parse_args()
    result=verify(args.folder,args.revision)
    (args.folder/'renders'/f'{args.revision}-verification.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
