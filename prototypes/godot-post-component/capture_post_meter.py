"""Paused source post evidence: one existing meter pixel, no geometry/render."""
from pathlib import Path
import importlib.util
import os

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
RUNNER=ROOT/'scripts/performance/run_browser.py'
COLLECTOR=HERE/'browser-post-meter.js'
spec=importlib.util.spec_from_file_location('godot_scene_capture',HERE.parent/'godot-render-component/capture_scene.py')
capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)


def adapt(source):
    source=capture.adapt(source)
    anchor="            page.evaluate(godot_exporter.read_text(encoding='utf-8'))"
    assert source.count(anchor)==1,'Native capture boundary changed'
    collect='''            result['postMeterCaptureOnly']=True
            result['acceptanceEligible']=False
            page.evaluate(post_collector.read_text(encoding='utf8'))
            pack=page.evaluate('(source)=>__ghPostMeter.capture(source)',{'coreSHA256':result['coreSHA256'],'sessionId':name})
            assert pack['schema']=='gh-post-meter-evidence-v1'
            for row in [pack.get('finalSource',{}),*pack.get('compiled',[])]:
                for key in ['vertex','fragment','readMeterMethod']:
                    value=row.get(key)
                    if isinstance(value,str):
                        payload=value.encode('utf8')
                        row[key+'SHA256']=hashlib.sha256(payload).hexdigest()
                        row[key+'Bytes']=len(payload)
            pack['collectorSHA256']=hashlib.sha256(post_collector.read_bytes()).hexdigest()
            payload=json.dumps(pack,ensure_ascii=False,allow_nan=False,indent=2).encode('utf8')
            assert len(payload)<=262144,'Bounded post evidence exceeded; not truncated'
            path=OUT/(name+'-post-meter.json')
            assert not path.exists()
            path.write_bytes(payload)
            result['postMeter']={'path':str(path),'sha256':hashlib.sha256(payload).hexdigest(),
              'ok':pack['ok'],'source':pack['source'],'errors':pack['errors'],'gaps':pack['gaps'],
              'read':pack.get('read'),'exposureParameters':pack.get('exposureParameters'),
              'operations':pack['operations'],'collectorSHA256':pack['collectorSHA256']}
            # Preserve the complete invalid report before asserting its result.
            assert pack['ok'],pack['errors']
            assert pack['operations']['nativeMeterReads']==1
            assert pack['finalSource']['fragmentSHA256']=='d57a2ec1063369281be2d7a85ccfc95c86a9a40ca239159442fd3c437fdd3b1a','Reviewed original final shader changed'
            result['captureSnapshot']=page.evaluate('__frames.snapshot()')
            page.screenshot(path=str(OUT/(name+'.png')))
            result['consoleErrorsAtCapture']=result['consoleErrors'][:]
            assert not result['consoleErrorsAtCapture']
            browser.close();result['ok']=True
            print('GODOT-POST-METER',json.dumps(result['postMeter']),flush=True)
            raise SystemExit(0)
'''
    preflight='from playwright.sync_api import sync_playwright'
    assert source.count(preflight)==1,'Owning runner import boundary changed'
    source=source.replace(preflight,"if not args.native_loop or args.quality!='high' or (args.width,args.height)!=(1920,1080):\n    P.error('Post meter capture requires --native-loop --quality high at1920x1080')\n"+preflight,1)
    return source.replace(anchor,collect+anchor,1)


if __name__=='__main__':
    os.environ.setdefault('GH_BENCH_OUT',str(HERE/'evidence'))
    exec(compile(adapt(RUNNER.read_text(encoding='utf8')),str(RUNNER),'exec'),
         {'__name__':'__main__','__file__':str(RUNNER),'post_collector':COLLECTOR})
