"""Owned, bounded native Godot component smoke. Not full-game acceptance."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time

HERE = Path(__file__).resolve().parent

def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',type=Path,required=True)
    parser.add_argument('--engine',type=Path,required=True,help='Native Godot 4 console executable; tested on 4.7.2')
    parser.add_argument('--name',required=True)
    parser.add_argument('--frames',type=int,default=120)
    parser.add_argument('--warmup',type=int,default=2)
    parser.add_argument('--timeout',type=int,default=180)
    parser.add_argument('--material-mode',choices=['source-scalars','normal-debug','pbr-adaptor'],default='source-scalars')
    parser.add_argument('--textures',type=Path,help='Same-session lossless texture manifest')
    parser.add_argument('--shader-audit',type=Path,help='Explicit frozen GL proof JSON; requires pbr-adaptor')
    parser.add_argument('--source-decay',type=int,choices=[0,1],default=0,help='Map original PointLight decay; native control remains0')
    parser.add_argument('--direct-energy',choices=['native','source-irradiance'],default='native',help='Explicit direct-light input convention; source mode uses I/PI')
    parser.add_argument('--light-color',choices=['native','source-linear'],default='native',help='Source mode encodes original linear RGB once at Light3D property boundary')
    parser.add_argument('--lightfield',choices=['off','source-diffuse'],default='off',help='Fixed reviewed HM diffuse term; not live clock or High parity')
    parser.add_argument('--volume-bytes',type=Path,help='External exact original HM half-float asset')
    parser.add_argument('--lightfield-fixture',type=Path,help='Byte-pinned HM role/code/clock proof; default render/fixtures/hm-source.json')
    parser.add_argument('--light-energy-scale',type=float,default=1)
    parser.add_argument('--emission-scale',type=float,default=1)
    parser.add_argument('--tonemap',choices=['linear','aces'],default='linear')
    args=parser.parse_args()
    if args.shader_audit and args.material_mode!='pbr-adaptor':
        parser.error('--shader-audit requires explicit --material-mode=pbr-adaptor')
    if args.lightfield!='off' and (args.material_mode!='pbr-adaptor' or args.volume_bytes is None):
        parser.error('--lightfield=source-diffuse requires --material-mode=pbr-adaptor and --volume-bytes')
    if args.lightfield=='off' and (args.volume_bytes is not None or args.lightfield_fixture is not None):
        parser.error('HM assets require explicit --lightfield=source-diffuse')
    assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,100}',args.name)
    assert 1<=args.frames<=7200 and 2<=args.warmup<=7200 and 1<=args.timeout<=600
    assert all(math.isfinite(value) and value>=0 for value in [args.light_energy_scale,args.emission_scale])
    snapshot=args.snapshot.resolve();assert snapshot.is_file()
    engine=args.engine.resolve();assert engine.is_file()
    runtime={'console':str(engine),'consoleSHA256':sha(engine),'kind':'Caller-selected native Godot executable; acquisition verification is separate evidence'}
    project=HERE/'render';out=HERE/'evidence';out.mkdir(exist_ok=True)
    paths={key:out/(args.name+suffix) for key,suffix in
           [('report','.json'),('run','.run.json'),('log','.log'),('screenshot','.png')]}
    assert not any(path.exists() for path in paths.values()),'Use a fresh name'
    source_hashes={name:sha(project/name) for name in ['main.gd','main.tscn','project.godot',
      'texture_binding.gd','pbr_adaptor.gd','source_shaders.gd','shaft.gdshader']}
    if args.lightfield!='off':
        source_hashes.update({name:sha(project/name) for name in ['lightfield_binding.gd','lightfield.gdshaderinc']})
    command=[str(engine),'--path',str(project),'--rendering-method','forward_plus',
      '--rendering-driver','vulkan','--','--snapshot='+str(snapshot),
      '--report='+str(paths['report']),'--screenshot='+str(paths['screenshot']),
      '--quit-on-complete=1','--warmup-frames='+str(args.warmup),
      '--sample-frames='+str(args.frames),'--fps-cap=60','--material-mode='+args.material_mode,
      '--light-energy-scale='+str(args.light_energy_scale),'--emission-scale='+str(args.emission_scale),
      '--tonemap='+args.tonemap]
    command+=['--source-decay='+str(args.source_decay),'--direct-energy='+args.direct_energy,'--light-color='+args.light_color]
    if args.textures:
        assert args.textures.is_file(),'Missing same-session texture manifest'
        command.append('--textures='+str(args.textures.resolve()))
    if args.shader_audit:
        assert args.shader_audit.is_file(),'Missing explicit shader proof'
        command.append('--shader-audit='+str(args.shader_audit.resolve()))
    if args.lightfield!='off':
        assert args.volume_bytes.is_file(),'Missing original external HM binary'
        assert args.volume_bytes.stat().st_size==397440,'Original HM byte length required'
        assert sha(args.volume_bytes)=='86c55fed4284279faa5b547a9a5a52d6b9b29e220d90dcf16a58c2d67819b1dd','Original HM SHA mismatch'
        command+=['--lightfield=source-diffuse','--volume-bytes='+str(args.volume_bytes.resolve())]
        if args.lightfield_fixture is not None:
            assert args.lightfield_fixture.is_file(),'Missing reviewed HM fixture'
            command.append('--lightfield-fixture='+str(args.lightfield_fixture.resolve()))
    result={'classification':'Frozen real-scene render-component smoke; not full AI/High acceptance',
      'acceptanceEligible':False,'ok':False,'command':command,'runtime':runtime,
      'snapshot':str(snapshot),'snapshotSHA256':sha(snapshot),'projectSHA256':source_hashes}
    result['lightMappingOptions']={'sourceDecay':args.source_decay,'directEnergy':args.direct_energy,'lightColor':args.light_color}
    if args.textures: result['textureManifestSHA256']=sha(args.textures)
    if args.shader_audit: result['shaderProofSHA256']=sha(args.shader_audit)
    if args.lightfield!='off':
        fixture=args.lightfield_fixture or project/'fixtures/hm-source.json'
        result['lightfieldOptions']={'mode':args.lightfield,'fixtureSHA256':sha(fixture),'volumeSHA256':sha(args.volume_bytes),'fixedClock':True,'liveClock':False}
    started=time.perf_counter();proc=None
    try:
        with paths['log'].open('wb') as log:
            proc=subprocess.Popen(command,cwd=project,stdout=log,stderr=subprocess.STDOUT)
            result['ownedRootPID']=proc.pid
            result['exitCode']=proc.wait(timeout=args.timeout)
        result['elapsedSeconds']=time.perf_counter()-started
        lines=paths['log'].read_text(encoding='utf-8',errors='replace').splitlines()
        result['engineErrors']=[line for line in lines if line.startswith('ERROR:') or 'SCRIPT ERROR:' in line or 'SHADER ERROR:' in line]
        assert result['exitCode']==0,result['exitCode']
        assert not result['engineErrors'],result['engineErrors'][:10]
        report=json.loads(paths['report'].read_bytes())
        assert report['schema']=='gh-godot-render-report-v1'
        assert report['renderOnly'] and report['frozenScene'] and not report['fullAI'] and not report['highParity']
        assert len(report['frames'])==args.frames
        assert report['viewport']==[1920,1080] and report['viewport_msaa_3d']==2
        assert report['directional_shadow_size']==4096
        if args.lightfield!='off':
            hm=report['source_lightfield']
            assert hm['enabled'] and hm['texture_uploaded'] and not hm['errors']
            assert hm['asset_bytes']==397440 and hm['cpu_image_bytes_exact'] and hm['matched_materials']>0
            result['sourceLightfield']=hm
        assert report['gpu'] and not any(x in report['gpu'].lower() for x in ['llvmpipe','software','swiftshader','warp'])
        assert paths['screenshot'].is_file() and paths['screenshot'].stat().st_size>1000
        result.update(ok=True,gpu=report['gpu'],engine=report['engine'],sourceCounts=report['sourceCounts'],
                      importCounts=report['importCounts'],loadMS=report['load_ms'],frames=len(report['frames']))
        print(json.dumps({key:result[key] for key in ['ok','gpu','frames','loadMS','importCounts']},ensure_ascii=False))
    except Exception as error:
        result['failure']=repr(error)
        raise
    finally:
        if proc is not None and proc.poll() is None:
            killed=subprocess.run(['taskkill','/T','/F','/PID',str(proc.pid)],capture_output=True,text=True)
            result['ownedCleanup']={'returnCode':killed.returncode,'output':(killed.stdout+killed.stderr)[-2000:]}
        paths['run'].write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')

if __name__=='__main__':main()
