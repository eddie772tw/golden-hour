"""Same-session source geometry and lossless supported PBR assets for Godot."""
from pathlib import Path
import importlib.util
import os

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
RUNNER=ROOT/'scripts/performance/run_browser.py'
spec=importlib.util.spec_from_file_location('godot_scene_capture',HERE/'capture_scene.py')
capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)

def adapt(source):
    source=capture.adapt(source)
    anchor="            page.evaluate('__ghGodotExport.release()')"
    assert source.count(anchor)==1
    extra='''            import base64
            page.evaluate(texture_exporter.read_text(encoding='utf8'))
            texture_manifest=page.evaluate('(name)=>__ghGodotTextures.capture({sessionId:name})',name)
            asset_root=(OUT/(name+'-assets')).resolve();asset_root.mkdir(exist_ok=False)
            for texture_id,meta in texture_manifest['textures'].items():
                if meta['status']!='captured':continue
                asset_path=(asset_root/meta['file']).resolve()
                assert asset_path.is_relative_to(asset_root),'Asset path escapes capture directory'
                asset_path.parent.mkdir(parents=True,exist_ok=True)
                assert not asset_path.exists()
                image_digest=hashlib.sha256();offset=0
                with asset_path.open('wb') as asset_file:
                    while True:
                        part=page.evaluate('([id,offset])=>__ghGodotTextures.readAsset(id,offset,262144)',[texture_id,offset])
                        payload=base64.b64decode(part['base64'],validate=True)
                        assert part['offset']==offset and part['nextOffset']-offset==len(payload)
                        assert len(payload)<=262144 and part['byteLength']==meta['byteLength']
                        asset_file.write(payload);image_digest.update(payload);offset=part['nextOffset']
                        if part['done']:break
                assert offset==meta['byteLength'] and image_digest.hexdigest()==meta['sha256']
            texture_path=asset_root/'manifest.json'
            texture_path.write_text(json.dumps(texture_manifest,ensure_ascii=False,allow_nan=False),encoding='utf8')
            result['textureExport']={'manifest':str(texture_path),'sha256':hashlib.sha256(texture_path.read_bytes()).hexdigest(),
              'counts':texture_manifest['counts'],'source':texture_manifest['source'],
              'exporterSHA256':hashlib.sha256(texture_exporter.read_bytes()).hexdigest()}
            page.evaluate('__ghGodotTextures.release()')
            print('GODOT-TEXTURE-CAPTURE',json.dumps(texture_manifest['counts']),flush=True)
'''
    return source.replace(anchor,extra+anchor,1)

if __name__=='__main__':
    os.environ.setdefault('GH_BENCH_OUT',str(HERE/'evidence'))
    exec(compile(adapt(RUNNER.read_text(encoding='utf8')),str(RUNNER),'exec'),
      {'__name__':'__main__','__file__':str(RUNNER),
       'godot_exporter':HERE/'render/browser-exporter.js',
       'texture_exporter':HERE/'render/browser-textures.js'})
