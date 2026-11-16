"""Paused source renderer, bounded exposure/film UNIT; not full post or FPS."""
from pathlib import Path
import importlib.util
import os

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
RUNNER=ROOT/'scripts/performance/run_browser.py'
UNIT=HERE
spec=importlib.util.spec_from_file_location('capture_scene',HERE.parent/'godot-render-component/capture_scene.py')
capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)

def adapt(source):
    source=capture.adapt(source)
    anchor="            page.evaluate(godot_exporter.read_text(encoding='utf-8'))"
    assert source.count(anchor)==1,'Owning native pause boundary changed'
    extra='''            result['postFilmUnitOnly']=True
            result['acceptanceEligible']=False
            proof_bytes=(film_unit/'render/fixtures/source-post-proof.json').read_bytes()
            assert hashlib.sha256(proof_bytes).hexdigest()=='1aa0aab81b3ec8458aaf4d549d917e327e9f3937445b6b469d3daab081de8a54'
            proof=json.loads(proof_bytes)
            case_bytes=(film_unit/'render/fixtures/post-cases.json').read_bytes()
            assert hashlib.sha256(case_bytes).hexdigest()=='6db440ac7224472c9a5dc6bc8780d66d161b2e5f25c76bf11711ce63fa9a5543'
            cases=json.loads(case_bytes)
            original=page.evaluate('GH.debug.gfx.final.material.fragmentShader')
            assert hashlib.sha256(original.encode('utf8')).hexdigest()==proof['sourceFinalFragmentSHA256']
            oracle=film_unit/'browser-film-oracle.js'
            page.evaluate(oracle.read_text(encoding='utf8'))
            pack=page.evaluate('(o)=>__ghThreePostFilm.run(o)',{'proof':proof,'cases':cases,'coreSHA256':result['coreSHA256']})
            for row in [pack.get('unitCode',{})]:
                for key in ['vertex','fragment']:
                    if isinstance(row.get(key),str):row[key+'SHA256']=hashlib.sha256(row[key].encode('utf8')).hexdigest()
            for key in ['sourceFinalFragment','sourceFinalVertex']:
                if isinstance(pack.get(key),str):pack[key+'SHA256']=hashlib.sha256(pack[key].encode('utf8')).hexdigest()
            payload=json.dumps(pack,ensure_ascii=False,allow_nan=False,indent=2).encode('utf8')
            assert len(payload)<=262144,'Unit evidence cap exceeded; no truncation'
            path=OUT/(name+'-three-film.json');assert not path.exists();path.write_bytes(payload)
            result['postFilmUnit']={'path':str(path),'sha256':hashlib.sha256(payload).hexdigest(),'ok':pack['ok'],
              'oracleSHA256':hashlib.sha256(oracle.read_bytes()).hexdigest(),'fixedExposure':pack['fixedExposure'],
              'invalidCases':pack.get('invalidCases'),'allReferenceChannelsExact':pack.get('allReferenceChannelsExact'),
              'error':pack.get('error'),'restoreErrors':pack['restoreErrors'],'finalGLErrors':pack['finalGLErrors']}
            assert pack['ok'],result['postFilmUnit']
            assert not result['consoleErrors'],result['consoleErrors']
            browser.close();result['ok']=True
            print('THREE-POST-FILM',json.dumps(result['postFilmUnit']),flush=True)
            raise SystemExit(0)
'''
    preflight='from playwright.sync_api import sync_playwright'
    assert source.count(preflight)==1
    source=source.replace(preflight,"if not args.native_loop or args.quality!='high' or (args.width,args.height)!=(1920,1080):\n    P.error('Film unit capture requires native High1920x1080')\n"+preflight,1)
    return source.replace(anchor,extra+anchor,1)

if __name__=='__main__':
    os.environ.setdefault('GH_BENCH_OUT',str(HERE/'evidence'))
    exec(compile(adapt(RUNNER.read_text(encoding='utf8')),str(RUNNER),'exec'),
      {'__name__':'__main__','__file__':str(RUNNER),'film_unit':UNIT})
