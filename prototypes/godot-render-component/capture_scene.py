"""Capture real paused source geometry for Godot; never a Web FPS run."""
from pathlib import Path
import hashlib
import os

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RUNNER = ROOT / 'scripts/performance/run_browser.py'
EXPORTER = HERE / 'render/browser-exporter.js'

def adapt(source):
    anchor = "            page.wait_for_function('GH.benchmark.done',polling=args.completion_poll_ms or 'raf',timeout=180000)"
    assert source.count(anchor) == 1, 'Owning runner capture boundary changed'
    capture = '''            result['godotAssetCaptureOnly']=True
            result['acceptanceEligible']=False
            page.evaluate(''' + "'''" + '''()=>{
              const input=GH.debug.ctx.input, end=input.endFrame;
              input.endFrame=function(...args){
                const value=end.apply(this,args);
                if(GH.benchmark.tick===240){
                  GH.G.state='paused';window.__ghGodotPaused=true;input.endFrame=end;
                }
                return value;
              };
            }''' + "'''" + ''')
            page.wait_for_function('window.__ghGodotPaused===true',polling=50,timeout=45000)
            result['fixture']=page.evaluate('GH.benchmark.export()')
            assert result['fixture']['tick']==240 and not result['fixture']['done']
            page.evaluate(godot_exporter.read_text(encoding='utf-8'))
            scene=page.evaluate('(source)=>__ghGodotExport.capture(source)',{'coreSHA256':result['coreSHA256']})
            assert scene['schema']=='gh-godot-render-snapshot-v1' and scene['source']['tick']==240
            assert scene['parity']['renderOnly'] and not scene['parity']['highParity']
            scene_path=OUT/(name+'-scene.json')
            assert not scene_path.exists()
            print('GODOT-CAPTURE-HEADER',json.dumps(scene),flush=True)
            page.evaluate('__ghGodotExport.begin()')
            digest=hashlib.sha256();chunks=0;total_bytes=0
            with scene_path.open('wb') as scene_file:
                while True:
                    part=page.evaluate('__ghGodotExport.readChunk(1048576)')
                    payload=part['chunk'].encode('utf-8')
                    scene_file.write(payload);digest.update(payload)
                    chunks+=1;total_bytes+=len(payload)
                    if chunks%64==0:print('GODOT-CAPTURE-BYTES',total_bytes,flush=True)
                    if part['done']:break
            page.evaluate('__ghGodotExport.release()')
            result['sceneExport']={'path':str(scene_path),'sha256':digest.hexdigest(),'chunks':chunks,'bytes':total_bytes,
              'exporterSHA256':hashlib.sha256(godot_exporter.read_bytes()).hexdigest(),'counts':scene['counts'],
              'source':scene['source'],'parity':scene['parity'],'exportMS':scene['exportMS']}
            result['captureSnapshot']=page.evaluate('__frames.snapshot()')
            page.screenshot(path=str(OUT/(name+'.png')))
            result['consoleErrorsAtCapture']=result['consoleErrors'][:]
            assert not result['consoleErrorsAtCapture']
            browser.close()
            result['ok']=True
            print('GODOT-ASSET-CAPTURE',name,json.dumps(scene['counts']),flush=True)
            raise SystemExit(0)
'''
    preflight="from playwright.sync_api import sync_playwright"
    assert source.count(preflight)==1
    source=source.replace(preflight,"if not args.native_loop or args.quality!='high' or (args.width,args.height)!=(1920,1080):\n    P.error('Godot capture requires --native-loop --quality high at 1920x1080')\n"+preflight,1)
    return source.replace(anchor,capture,1)

if __name__ == '__main__':
    os.environ.setdefault('GH_BENCH_OUT',str(HERE/'evidence'))
    source=RUNNER.read_text(encoding='utf-8')
    exec(compile(adapt(source),str(RUNNER),'exec'),
         {'__name__':'__main__','__file__':str(RUNNER),'godot_exporter':EXPORTER})
