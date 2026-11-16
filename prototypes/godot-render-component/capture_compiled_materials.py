"""New paused compiled-uniform/ORM/HM evidence capture; no Web FPS round.

Reuses the existing native tick240 pause adapter, then returns before geometry
export. Metadata stays bounded; every CPU asset is streamed and hash verified.
"""
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
    anchor="            page.evaluate(godot_exporter.read_text(encoding='utf-8'))"
    assert source.count(anchor)==1,'Native capture injection point changed'
    collect='''            import base64
            result['compiledMaterialCaptureOnly']=True
            result['acceptanceEligible']=False
            page.evaluate(compiled_exporter.read_text(encoding='utf8'))
            pack=page.evaluate('(o)=>__ghCompiledMaterials.capture(o)',{'coreSHA256':result['coreSHA256'],'sessionId':name})
            assert pack['schema']=='gh-compiled-material-evidence-v1'
            assert pack['source']['tick']==240 and pack['source']['state']=='paused'
            assert pack['lightVolume'] is not None,'Native HM volume missing; do not substitute particle noise'
            assert pack['counts']['compiledLVMaterials']>0,'No existing compiled ghLV table captured'
            assert pack['counts']['compiledLVIdentityMismatches']==0,'Compiled ghLV differs from authoritative HM texture'
            lv=pack['textures'][pack['lightVolume']['texture']['texture']]
            assert lv['flags']['data3D'] and lv['status']=='captured'
            assert pack['assets'][lv['asset']]['arrayType']=='Uint16Array','Expected original HM half-float words, not noise/requantized data'
            asset_root=(OUT/(name+'-compiled-assets')).resolve();asset_root.mkdir(exist_ok=False)
            for asset_id,meta in pack['assets'].items():
                path=(asset_root/meta['file']).resolve()
                assert path.is_relative_to(asset_root),'Asset path escapes capture directory'
                path.parent.mkdir(parents=True,exist_ok=True)
                assert not path.exists()
                digest=hashlib.sha256();offset=0
                with path.open('wb') as asset_file:
                    while True:
                        part=page.evaluate('([id,offset])=>__ghCompiledMaterials.readAsset(id,offset,262144)',[asset_id,offset])
                        payload=base64.b64decode(part['base64'],validate=True)
                        assert part['offset']==offset and part['nextOffset']-offset==len(payload)
                        assert len(payload)<=262144 and part['byteLength']==meta['byteLength']
                        asset_file.write(payload);digest.update(payload);offset=part['nextOffset']
                        if part['done']:break
                assert offset==meta['byteLength'] and digest.hexdigest()==meta['sha256']
            path=asset_root/'manifest.json'
            path.write_text(json.dumps(pack,ensure_ascii=False,allow_nan=False),encoding='utf8')
            result['compiledMaterials']={'manifest':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'counts':pack['counts'],'source':pack['source'],'lightVolume':pack['lightVolume'],'gaps':pack['gaps'],
              'exporterSHA256':hashlib.sha256(compiled_exporter.read_bytes()).hexdigest()}
            page.evaluate('__ghCompiledMaterials.release()')
            result['captureSnapshot']=page.evaluate('__frames.snapshot()')
            page.screenshot(path=str(OUT/(name+'.png')))
            result['consoleErrorsAtCapture']=result['consoleErrors'][:]
            assert not result['consoleErrorsAtCapture']
            browser.close();result['ok']=True
            print('GODOT-COMPILED-MATERIALS',json.dumps(result['compiledMaterials']),flush=True)
            raise SystemExit(0)
'''
    return source.replace(anchor,collect+anchor,1)

if __name__=='__main__':
    os.environ.setdefault('GH_BENCH_OUT',str(HERE/'evidence'))
    exec(compile(adapt(RUNNER.read_text(encoding='utf8')),str(RUNNER),'exec'),
      {'__name__':'__main__','__file__':str(RUNNER),
       'compiled_exporter':HERE/'render/browser-compiled-uniforms.js'})
