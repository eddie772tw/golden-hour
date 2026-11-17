"""Original Edge only. Normal Play.cmd + Deploy, isolated storage, raw submitted-frame intervals."""
import argparse, hashlib, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
if os.environ.get('GH_BENCH_DEPS'):
    sys.path.insert(0, os.environ['GH_BENCH_DEPS'])

P = argparse.ArgumentParser()
P.add_argument('--client', type=Path, required=True)
P.add_argument('--name', required=True)
P.add_argument('--quality', choices=['medium', 'high'], default='medium')
P.add_argument('--seconds', type=int, default=60)
P.add_argument('--smoke', action='store_true')
P.add_argument('--functional', action='store_true')
P.add_argument('--diagnostic', action='store_true')
P.add_argument('--deep-render', action='store_true', help='diagnostic-only passive shadow/program/AI/body timings')
P.add_argument('--loop-observe', action='store_true', help='passive native RAF request/callback/render diagnostic')
P.add_argument('--completion-poll-ms', type=int, default=0, help='benchmark completion interval polling; 0 retains legacy RAF polling')
P.add_argument('--profile', action='store_true')
P.add_argument('--trace-threads', action='store_true', help='diagnostic-only browser trace during native ticks 900..2100')
P.add_argument('--program-audit', action='store_true', help='requires isolated diagnostic core patch; never primary FPS')
P.add_argument('--fx-pixel-oracle', action='store_true', help='after scenario, compare FX light isolation on/off with frozen scene')
P.add_argument('--fracture-oracle', action='store_true', help='paused post-scenario strict two-sided glass pixel oracle')
P.add_argument('--render-dev', action='store_true', help='opt-in CPU/GPU per-pass developer observer, diagnostic-only')
P.add_argument('--scripted', action='store_true')
P.add_argument('--full-ai', action='store_true', help='fixed player inputs with all native AI paths enabled')
P.add_argument('--native-loop', action='store_true', help='exercise native decoupled loop with controlled full AI')
P.add_argument('--shader-warmup', action='store_true', help='opt-in real first-draw coverage and all retained program waits')
P.add_argument('--casing-worklet', action='store_true', help='opt-in casing source pool; original voice routing remains')
P.add_argument('--casing-pcm-oracle', action='store_true', help='diagnostic original WebAudio vs candidate DSP at 44.1/48 kHz')
P.add_argument('--loop-cost', action='store_true', help='diagnostic catch-up tick phase costs; separate from clean FPS')
P.add_argument('--loop-upload-bytes', action='store_true', help='also count buffer upload payload bytes; requires --loop-cost')
P.add_argument('--shader-pixel-oracle', action='store_true', help='post-scenario frozen-scene warmup off/on pixel comparison')
P.add_argument('--gl-delete-audit', action='store_true', help='diagnostic GL deletion call stacks after context restoration')
P.add_argument('--seed', type=int, default=0x47484d31)
P.add_argument('--width', type=int, default=1920)
P.add_argument('--height', type=int, default=1080)
args = P.parse_args()
if args.native_loop:
    args.full_ai = True
if args.full_ai:
    args.scripted = True
if args.deep_render:
    args.diagnostic = True
if args.loop_observe and not args.scripted:
    P.error('--loop-observe requires --scripted, --full-ai or --native-loop')
if args.completion_poll_ms < 0:
    P.error('--completion-poll-ms must be zero or a positive interval')
if args.loop_upload_bytes and not args.loop_cost:
    P.error('--loop-upload-bytes requires --loop-cost')
if args.loop_cost and not args.native_loop:
    P.error('--loop-cost requires --native-loop')
from playwright.sync_api import sync_playwright
OUT = Path(os.environ.get('GH_BENCH_OUT', str(ROOT / 'evidence'))).resolve()
OUT.mkdir(parents=True, exist_ok=True)
name = args.name
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}', name):
    raise ValueError('Use a simple unique evidence name without path separators')
if (OUT / (name + '.json')).exists():
    raise RuntimeError('Refusing to overwrite evidence: ' + name)
data_dir = OUT / 'isolated' / name
data_dir.mkdir(parents=True, exist_ok=True)
env = {k:v for k,v in os.environ.items() if not k.startswith('GH_')}
env.update(GH_NO_BROWSER='1', GH_NONINTERACTIVE='1', GH_CLIENT_PORT='48910',
           GH_SERVER_PORT='48913', GH_ROUND_SECONDS='3600', GH_DATA_DIR=str(data_dir),
           GH_CAREER_DB=str(data_dir / 'career.sqlite'), LOCALAPPDATA=str(data_dir / 'appdata'))
result = {'name': name, 'quality': args.quality, 'seconds': args.seconds,
          'coreSHA256': hashlib.sha256((args.client / 'game/core/game.js').read_bytes()).hexdigest(),
          'profiler': args.profile, 'trace': False, 'gpuTimer': args.diagnostic, 'osSampler': False,
          'deepRender': args.deep_render,
          'nativeLoop': args.native_loop,
          'candidateFeatures': {'shaderWarmup': args.shader_warmup, 'casingWorklet': args.casing_worklet},
          'workletSourceExperimentDiagnostic': args.casing_worklet,
          'developerProbeDiagnostic': bool(args.loop_cost or args.casing_pcm_oracle or args.shader_pixel_oracle or args.gl_delete_audit),
          'coldDefinition': 'fresh browser context/storage/HTTP cache; OS and driver caches retained'}
client_manifest = args.client.parent / (args.client.name + '-manifest.json')
if client_manifest.is_file():
    manifest_bytes = client_manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    assert manifest['files']['game/core/game.js'] == result['coreSHA256'], 'Stale client manifest'
    result['clientSource'] = {'commit': manifest['commit'],
                             'manifestSHA256': hashlib.sha256(manifest_bytes).hexdigest(),
                             'vendor': manifest['vendor'], 'definition': manifest['definition']}
log = (OUT / (name + '-server.log')).open('w', encoding='utf8')
proc = subprocess.Popen([os.environ['ComSpec'], '/d', '/c', 'Play.cmd', 'solo'], cwd=args.client,
                        env=env, stdout=log, stderr=subprocess.STDOUT)

INIT = r"""(() => {
  const p = window.__frames = {frames: [], events: [], errors: [], phase: 'loading', marks: []};
  p.mark = s => {p.phase=s; p.marks.push([performance.now(),s]);};
  if (globalThis.__ghObservePerformanceEvents === true) for (const type of ['longtask','long-animation-frame']) try {
    new PerformanceObserver(list => {for(const e of list.getEntries()) p.events.push({type,...e.toJSON()});}).observe({type,buffered:true});
  } catch {}
  addEventListener('error', e => p.errors.push(e.message));
  addEventListener('unhandledrejection', e => p.errors.push(String(e.reason?.stack || e.reason)));
  document.addEventListener('pointerlockerror',()=>p.errors.push('pointerlockerror'));
  let installed=false;
  p.install = () => {
    if(installed) return; installed=true;
    const d=GH.debug, g=d.gfx, render=g.render; let last=0;
    g.render=function(dt) {
      const t=performance.now(), interval=last?t-last:0; last=t;
      try {return render.call(this,dt);} finally {
        p.frames.push([t,interval,performance.now()-t,p.phase,GH.G.state,document.hidden,
          d.player.alive,d.player.stats.shots,d.player.pos.x,d.player.pos.z,g.quality,GH.benchmark?.tick ?? null]);
      }
    };
  };
  p.snapshot = () => {
    const d=GH.debug,g=d.gfx,gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const audioContext=d.ctx.audio._engine.ctx;
    return {now:performance.now(),state:GH.G.state,match:d.match.state,stats:d.stats(),
      playerShots:d.player.stats.shots,focus:document.hasFocus(),hidden:document.hidden,
      dpr:devicePixelRatio,view:[innerWidth,innerHeight],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],
      renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),glError:gl.getError(),
      settings:{...d.ctx.settings},quality:g.quality,scale:g.q.scale,
      runtimeReady:GH.runtimeReady ?? null,boot:GHBoot.stats,
      startup:document.querySelector('#gh-startup')?.textContent,
      diagnostics:document.querySelector('#gh-performance')?.textContent,
      audio:{queue:d.ctx.audio._engine.bakeQ?.length,...d.ctx.audio._engine.stats,
        casing:d.ctx.audio._engine.casingAudio?.stats??null,
        context:audioContext?{sampleRate:audioContext.sampleRate,currentTime:audioContext.currentTime,
          baseLatency:audioContext.baseLatency,outputLatency:audioContext.outputLatency,
          outputTimestamp:audioContext.getOutputTimestamp?.(),performanceMS:performance.now()}:null},
      preparation:g.preparation ?? null,loopStats:JSON.parse(JSON.stringify(d.loopStats??GH.loopStats??null))};
  };
})();"""

def ready(page):
    page.wait_for_function('(window.GH?.ready && window.GH?.debug && document.querySelector("#gh-startup")) || document.getElementById("err")?.textContent', timeout=240000)
    if not page.evaluate('!!GH.ready'):
        raise RuntimeError(page.locator('#err').text_content())
    page.evaluate('async()=>{if(GHBoot.runtimeReady)await GHBoot.runtimeReady;if(GH.debug.gfx.whenReady)await GH.debug.gfx.whenReady();}')

def install_render_dev(page):
    page.evaluate('''async(source)=>{
      const {installRenderDiagnostics}=await import('/client/render-diagnostics.js');
      window.renderDev=installRenderDiagnostics(GH,{source,gpu:true,counters:true});
      renderDev.phaseMark(__frames.phase);
    }''',{'coreSHA256':result['coreSHA256'],'name':name})

def phase(page, label, seconds, moving=False, shooting=False):
    if page.evaluate('GH.G.state') != 'playing':
        page.bring_to_front()
        page.locator('[data-act="resume"]:visible').click()
    page.wait_for_function("GH.G.state==='playing' && GH.debug.match.state==='live'", timeout=45000)
    start = page.evaluate('__frames.snapshot()')
    assert not start['hidden'] and start['focus'], start
    page.evaluate('(s)=>{__frames.mark(s);window.__diag?.mark(s);}', label)
    if shooting: page.mouse.down()
    pattern = ['w','d','s','a']
    for i in range(seconds):
        key = pattern[(i//3)%4]
        if moving and i%3 == 0: page.keyboard.down(key)
        if shooting and i%4 == 3: page.keyboard.press('r')
        page.wait_for_timeout(1000)
        if moving and i%3 == 2: page.keyboard.up(key)
    for key in pattern: page.keyboard.up(key)
    if shooting: page.mouse.up()
    page.evaluate("__frames.mark('transition')")
    end = page.evaluate('__frames.snapshot()')
    result.setdefault('phases', {})[label] = {'start': start, 'end': end}
    result['measurement']=page.evaluate('__frames')
    assert end['state']=='playing' and not end['hidden'] and end['quality']==args.quality, end
    audio_summary = dict(end['audio'])
    if audio_summary.get('casing'):
        audio_summary['casing'] = {k:v for k,v in audio_summary['casing'].items() if k != 'timings'}
    print('PHASE', name, label, json.dumps({'state':end['state'],'quality':end['quality'],'shots':end['playerShots'],'pos':end['stats']['pos'],'audio':audio_summary}), flush=True)

def deploy(page):
    # A preparation gate may require a new user gesture after its asynchronous work.
    for _ in range(3):
        page.locator('#pg-main [data-act="deploy"]').click(timeout=60000)
        page.wait_for_timeout(100)
        page.evaluate('async()=>{const g=GH.debug.gfx;if(g._deploying)await g._deploying;if(g.whenReady)await g.whenReady();}')
        if page.evaluate('GH.G.state')=='playing': break
    page.wait_for_function("GH.G.state==='playing' && GH.debug.match.state==='live'",timeout=60000)

def fresh_match(page):
    # Use the normal forfeit/menu/Deploy flow. A full round can finish in <135s;
    # each measured phase needs its own live round rather than mixing in 20FPS results.
    if page.evaluate('GH.G.state')=='playing': page.keyboard.press('Escape')
    if page.evaluate('GH.G.state')=='paused':
        page.locator('[data-act="quit"]:visible').click()
        page.locator('[data-act="quit"]:visible').click()
    else:
        page.locator('[data-act="tomenu"]:visible').click()
    page.wait_for_function("GH.G.state==='menu'")
    deploy(page)

try:
    for _ in range(200):
        try:
            urllib.request.urlopen('http://127.0.0.1:48910/api/health',timeout=1)
            break
        except Exception: time.sleep(.1)
    else: raise RuntimeError('Server failed: ' + (OUT/(name+'-server.log')).read_text(errors='replace'))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=False,
            args=['--start-fullscreen','--disable-background-networking'], ignore_default_args=['--enable-unsafe-swiftshader'])
        context = browser.new_context(viewport={'width':args.width,'height':args.height},device_scale_factor=1,locale='en-US')
        performance_events=bool(args.diagnostic or args.profile or args.trace_threads or args.program_audit or args.render_dev)
        result['performanceEventsObserver']=performance_events
        context.add_init_script('window.__ghObservePerformanceEvents='+json.dumps(performance_events)+';'+INIT)
        if args.gl_delete_audit:
            context.add_init_script((ROOT/'gl_delete_audit.js').read_text(encoding='utf8'))
        if args.loop_observe:
            context.add_init_script((ROOT/'loop_observer.js').read_text(encoding='utf8'))
            result['developerProbeDiagnostic']=True
        result['benchmarkCompletionPolling']=args.completion_poll_ms or 'raf'
        if args.full_ai:
            context.add_init_script('window.__fullAI=true;')
        if args.scripted:
            scenario_source=(args.client/'game/client/benchmark-scenario.js').read_text(encoding='utf8')
            preload=re.sub(r'^export ', '', scenario_source, flags=re.MULTILINE)
            context.add_init_script('(()=>{'+preload+'\nseedBenchmarkRandom('+str(args.seed)+');})();')
        context.add_init_script('localStorage.setItem("golden-hour-settings-v1",'+json.dumps(json.dumps({'quality':args.quality,'renderScale':1,'renderVersion':1,'motionBlur':'off'}))+');')
        page = context.new_page()
        result['consoleErrors']=[]
        result['consoleWarnings']=[]
        page.on('console', lambda message: result['consoleErrors'].append(message.text[:2000]) if message.type=='error' else None)
        page.on('console', lambda message: result['consoleWarnings'].append(message.text[:2000]) if message.type=='warning' else None)
        page.on('pageerror', lambda error: result['consoleErrors'].append(str(error)[:2000]))
        result['browserVersion'] = browser.version
        result['system'] = browser.new_browser_cdp_session().send('SystemInfo.getInfo')
        query = {'solo': ''}
        if args.shader_warmup: query['shaderWarmup'] = '1'
        if args.casing_worklet: query['casingAudio'] = 'worklet'
        result['query'] = query
        page.goto('http://127.0.0.1:48910/?'+urlencode(query),wait_until='domcontentloaded')
        ready(page)
        if args.shader_warmup:
            assert page.evaluate('GHBoot.shaderWarmupCandidate===true'), 'Shader candidate flag was not enabled'
        if args.casing_pcm_oracle:
            result['casingPCMOracle'] = page.evaluate('''async()=>{
              const {runCasingPCMOracle}=await import('/client/casing-pcm-oracle.js');
              const results=[];
              for(const sampleRate of [44100,48000]) results.push(await runCasingPCMOracle({sampleRate}));
              return results;
            }''')
        page.evaluate('__frames.install()')
        if args.render_dev and not args.scripted:
            assert not args.diagnostic, 'Do not mix old and new GPU observers'
            install_render_dev(page)
        if args.diagnostic and not args.scripted:
            page.evaluate((ROOT/'diagnostic.js').read_text(encoding='utf8'))
            page.evaluate('(deep)=>__diag.install({deep})',args.deep_render)
        result['cold'] = page.evaluate('__frames.snapshot()')
        assert not any(s in result['cold']['renderer'].lower() for s in ['swiftshader','llvmpipe','software','warp']),result['cold']
        assert result['cold']['buffer']==[args.width,args.height] and result['cold']['scale']==1, result['cold']
        assert result['cold']['quality']==args.quality, result['cold']
        print('READY',name,result['cold']['now'],result['cold']['renderer'],flush=True)
        if args.profile:
            profiler=context.new_cdp_session(page)
            profiler.send('Profiler.enable')
            profiler.send('Profiler.setSamplingInterval',{'interval':1000})
            profiler.send('Profiler.start')
        page.bring_to_front()
        page.evaluate('''()=>{document.querySelector('#pg-main [data-act="deploy"]').addEventListener('click',e=>{__frames.entryAt=performance.now();__frames.mark('first-entry')},{once:true,capture:true})}''')
        deploy(page)
        result['deployToLiveMs']=page.evaluate('performance.now()-__frames.entryAt')
        if args.casing_worklet:
            status=page.evaluate('GH.debug.ctx.audio._engine.casingAudio?.stats')
            assert status and status['status']=='ready' and status['warmed']==status['slots'], status
        if args.scripted:
            if args.loop_observe:
                page.evaluate("__loopPhase.reset('scenario')")
            result['scenarioStart']=page.evaluate('''async(options)=>{
              const {installBenchmarkScenario}=await import('/client/'+(window.__fullAI?'benchmark-full-ai.js':'benchmark-scenario.js'));
              const loopModule=options.loopCost?await import('/client/loop-cost-observer.js'):null;
              await installBenchmarkScenario(GH,{seed:options.seed,followNativeLoop:options.nativeLoop});
              if(loopModule)window.loopCost=loopModule.installLoopCostObserver(GH,{uploads:options.uploads});
              __frames.mark('scripted');__frames.scenarioAt=performance.now();window.__diag?.mark('scripted');return GH.benchmark.export();
            }''',{'seed':args.seed,'nativeLoop':args.native_loop,'loopCost':args.loop_cost,'uploads':args.loop_upload_bytes})
            if args.diagnostic:
                page.evaluate((ROOT/'diagnostic.js').read_text(encoding='utf8'))
                page.evaluate("(deep)=>{__diag.install({deep});__diag.mark('scripted');}",args.deep_render)
            if args.program_audit:
                page.evaluate('window.ghProgramAudit=Object.create(null)')
            if args.render_dev:
                assert not args.diagnostic, 'Do not mix old and new GPU observers'
                install_render_dev(page)
            if args.trace_threads:
                # Trace is its own diagnostic window; never use this run for the FPS gate.
                page.wait_for_function('GH.benchmark.tick>=900',polling=args.completion_poll_ms or 'raf',timeout=90000)
                tracer=browser.new_browser_cdp_session()
                complete=[]
                tracer.on('Tracing.tracingComplete',lambda event:complete.append(event))
                tracer.send('Tracing.start',{'categories':'toplevel,devtools.timeline,blink.user_timing,gpu,cc,viz,renderer.scheduler','transferMode':'ReturnAsStream'})
                result['traceWindowStart']=page.evaluate('({now:performance.now(),tick:GH.benchmark.tick,timeOrigin:performance.timeOrigin})')
                page.evaluate("performance.mark('gh-thread-window-start')")
                page.wait_for_function('GH.benchmark.tick>=2100',polling=args.completion_poll_ms or 'raf',timeout=90000)
                page.evaluate("performance.mark('gh-thread-window-end')")
                result['traceWindowEnd']=page.evaluate('({now:performance.now(),tick:GH.benchmark.tick})')
                tracer.send('Tracing.end')
                for _ in range(600):
                    if complete:break
                    page.wait_for_timeout(100)
                assert complete,'Tracing completion timeout'
                import base64
                handle=complete[0]['stream']
                with (OUT/(name+'.trace.json')).open('wb') as trace_file:
                    while True:
                        chunk=tracer.send('IO.read',{'handle':handle})
                        trace_file.write(base64.b64decode(chunk['data']) if chunk.get('base64Encoded') else chunk['data'].encode())
                        if chunk.get('eof'):break
                tracer.send('IO.close',{'handle':handle})
                result['trace']=True
            page.wait_for_function('GH.benchmark.done',polling=args.completion_poll_ms or 'raf',timeout=180000)
            result['scenario']=page.evaluate('GH.benchmark.export()')
            if args.loop_cost:
                result['loopCost']=page.evaluate('loopCost.export()')
                page.evaluate('loopCost.stop()')
            if args.loop_observe:
                result['loopPhase']=page.evaluate('__loopPhase.export()')
                page.evaluate('__loopPhase.restore()')
            if args.fracture_oracle:
                page.evaluate((ROOT/'fracture_oracle.js').read_text(encoding='utf8'))
                result['fractureOracle']=page.evaluate('(source)=>__fractureOracle.run({panes:3,oblique:true,source})',{'coreSHA256':result['coreSHA256']})
                result['postScenarioDiagnostic']=True
                assert result['fractureOracle']['status']=='pass',json.dumps(result['fractureOracle'])[:5000]
            if args.render_dev:
                result['renderDev']=page.evaluate('renderDev.export()')
                page.evaluate('renderDev.stop()')
            if args.fx_pixel_oracle:
                result['fxPixelOracle']=page.evaluate('''async()=>{
                  const g=GH.debug.gfx,r=g.renderer,gl=r.getContext(),prior=g.scene.ghSeparateFxLights;
                  const hashes=[];
                  try {
                    for(const enabled of [false,true,true,false]) {
                      g.scene.ghSeparateFxLights=enabled;
                      for(let i=0;i<3;i++) {
                        g._reflectAt=null;g._shadowAt=null;r.shadowMap.needsUpdate=true;
                        g.snapExposure();g.render(0);
                      }
                      const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
                      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
                      const colors=new Set();
                      for(let i=0;i<bytes.length;i+=4*997) colors.add((bytes[i]<<16)|(bytes[i+1]<<8)|bytes[i+2]);
                      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
                      hashes.push({enabled,hash,nonzero:bytes.some(x=>x!==0),sampledRGBColors:colors.size,error:gl.getError()});
                    }
                    return hashes;
                  }finally{g.scene.ghSeparateFxLights=prior;}
                }''')
                assert all(x['nonzero'] and x['sampledRGBColors']>16 and x['error']==0 for x in result['fxPixelOracle']),result['fxPixelOracle']
                assert len({x['hash'] for x in result['fxPixelOracle']})==1,result['fxPixelOracle']
            if args.program_audit:
                result['programAudit']=page.evaluate('window.ghProgramAudit')
                result['programAuditDiagnostic']=True
            result['scenarioWallMs']=page.evaluate('performance.now()-__frames.scenarioAt')
            result['scenarioLoopStats']=page.evaluate('JSON.parse(JSON.stringify(GH.debug.loopStats??GH.loopStats??null))')
            if args.shader_pixel_oracle:
                result['shaderPixelOracle']=page.evaluate('''async()=>{
                  if(GH.G.state!=='paused')throw Error('Oracle requires the completed paused scenario');
                  const g=GH.debug.gfx,r=g.renderer,gl=r.getContext(),prior=GHBoot.shaderWarmupCandidate;
                  const frames=[];
                  try {
                    for(const enabled of [false,true,true,false]) {
                      GHBoot.shaderWarmupCandidate=enabled;
                      await g.prepare('shader-pixel-oracle');
                      for(let i=0;i<3;i++) {
                        g._reflectAt=null;g._shadowAt=null;r.shadowMap.needsUpdate=true;
                        g.snapExposure();g.render(0);
                      }
                      const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
                      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
                      frames.push({enabled,pixels,error:gl.getError()});
                    }
                  }finally{GHBoot.shaderWarmupCandidate=prior;}
                  for(const frame of frames) {
                    frame.hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',frame.pixels)),b=>b.toString(16).padStart(2,'0')).join('');
                    frame.nonzero=frame.pixels.some(x=>x!==0);delete frame.pixels;
                  }
                  return {frames,equal:new Set(frames.map(f=>f.hash)).size===1,
                    boundary:'Frozen post-scenario scene, full preparation off/on/on/off; not every future shader variant'};
                }''')
                assert result['shaderPixelOracle']['equal'] and all(f['nonzero'] and f['error']==0 for f in result['shaderPixelOracle']['frames']),result['shaderPixelOracle']
            page.evaluate("__frames.mark('transition');window.__diag?.mark('transition');")
            assert result['scenario']['tick']==result['scenario']['manifest']['totalTicks'],result['scenario']['tick']
            assert result['scenario']['state']['actors'][0]['shots']>0,result['scenario']['state']
            assert all(a['shots']>0 for a in result['scenario']['state']['actors'][1:]),result['scenario']['state']
            if args.full_ai:
                s=result['scenario']; c=s['coverage']; calls=c['calls']
                assert c['botTicks']==[s['tick']]*9,c
                assert all(row.get('_perceive',0)>0 and row.get('_goTo',0)>0 for row in s['botCalls']),s['botCalls']
                assert all(calls.get(k,0)>0 for k in ['nav.path','die','respawn','addRagdoll','throwGrenade','grenadeExplode','k9.enemyTimer','k9.enemyThrow','k9._brain','k9._think','k9._pickTarget']),c
                assert c['k9ActiveTicks']>0 and sum(c['botDeadTicks'])>0,c
                assert c['bodySubsteps'].get('rag',0)>0 and c['bodySubsteps'].get('nade',0)>0,c
                assert c['nativeFragQueued']>0 and any(int(k)>0 and v>0 for k,v in c['nadeOwner'].items() if k!='other'),c
                assert c['perceptionLOS']['calls']>0 and c['timeScaleTicks']=={'1':s['tick']},c
            print('SCRIPTED',name,'tick',result['scenario']['tick'],'shots',[a['shots'] for a in result['scenario']['state']['actors']],flush=True)
        else:
            phase(page,'first-use',8 if args.smoke else 15,moving=True,shooting=True)
        if not args.smoke and not args.scripted:
            phase(page,'movement',args.seconds,moving=True)
            fresh_match(page)
            phase(page,'combat',args.seconds,moving=True,shooting=True)
        if args.functional:
            checks={}
            result['functional']=checks
            page.evaluate('''()=>{const p=__frames,d=GH.debug;p.inputEvents=[];
              const event=type=>p.inputEvents.push({t:performance.now(),type,locked:d.input.locked,element:document.pointerLockElement?.id,allow:d.input.allowLock,state:GH.G.state,focus:document.hasFocus(),active:navigator.userActivation.isActive,pending:d.gfx.preparation.pending,error:String(d.gfx.preparation.error||'')});
              for(const type of ['pointerlockchange','pointerlockerror'])document.addEventListener(type,()=>event(type));
              for(const type of ['blur','focus'])addEventListener(type,()=>event(type));
              const lock=d.input.lock;d.input.lock=function(...args){event('lock-call');return lock.apply(this,args)};
            }''')
            checks['locked']=page.evaluate('document.pointerLockElement===GH.debug.gfx.renderer.domElement')
            assert checks['locked'], 'Deploy did not retain a valid pointer-lock gesture'
            checks['reflection']=page.evaluate('''async()=>{
              const g=GH.debug.gfx, original=g.preRender; let count=0;
              g.preRender=function(...args){count++;return original.apply(this,args)};
              const start=performance.now();
              try {await new Promise(r=>setTimeout(r,2100)); return {count,ms:performance.now()-start};}
              finally {g.preRender=original;}
            }''')
            assert 0<checks['reflection']['count']<=checks['reflection']['ms']*.03+2,checks['reflection']
            checks['audioQueue']=page.evaluate('''async()=>{
              const a=GH.debug.ctx.audio._engine, before=a.bakeQ.length;
              await new Promise(r=>setTimeout(r,1000));return {before,after:a.bakeQ.length};
            }''')
            assert checks['audioQueue']['before']==checks['audioQueue']['after'],checks['audioQueue']
            page.keyboard.press('Escape')
            page.wait_for_function("GH.G.state==='paused'")
            checks['qualitySwitch']=page.evaluate('''async()=>{
              const g=GH.debug.gfx;
              await Promise.all([g.setQuality('medium'),g.setQuality('high'),g.setRenderScale(.8),g.setRenderScale(1)]);
              await g.whenReady();return {quality:g.quality,scale:g.q.scale,q:{...g.q},pending:g.preparation.pending,error:String(g.preparation.error||'')};
            }''')
            q=checks['qualitySwitch']
            checks['qualityGLerror']=page.evaluate('GH.debug.gfx.renderer.getContext().getError()')
            assert checks['qualityGLerror']==0, checks['qualityGLerror']
            assert q['quality']=='high' and q['scale']==1 and not q['pending'] and not q['error'],q
            assert all(q['q'][k]==v for k,v in {'samples':4,'shadow':4096,'ao':True,'refl':.5,'rays':40,'vol':20,'reflectionHz':30}.items()),q
            page.evaluate("async()=>{const g=GH.debug.gfx;await g.setMotionBlur('high');await g.whenReady();}")
            page.evaluate("async()=>{const g=GH.debug.gfx;await g.setMotionBlur('off');await g.whenReady();}")
            checks['motionBlurGLerror']=page.evaluate('GH.debug.gfx.renderer.getContext().getError()')
            assert checks['motionBlurGLerror']==0, checks['motionBlurGLerror']
            page.evaluate('''()=>{const g=GH.debug.gfx,gl=g.renderer.getContext();window.__loss=gl.getExtension('WEBGL_lose_context');if(!__loss)throw Error('No WEBGL_lose_context');__loss.loseContext();setTimeout(()=>__loss.restoreContext(),350);}''')
            page.wait_for_function("GH.debug.gfx.renderer.getContext().isContextLost()",timeout=10000)
            page.evaluate('''async()=>{window.__contextDiagnostics=(await import('/client/webgl-context.js')).contextDiagnostics;}''')
            page.wait_for_function("!GH.debug.gfx.renderer.getContext().isContextLost()",timeout=180000)
            page.evaluate('async()=>{await GH.debug.gfx.whenReady();}')
            page.wait_for_function("__contextDiagnostics(GH.debug.gfx.renderer.domElement).status==='restored'&&!GH.debug.gfx.preparation.pending&&!GH.debug.gfx.preparation.error",timeout=180000)
            checks['contextRestore']=page.evaluate('__frames.snapshot()')
            assert checks['contextRestore']['state']=='paused',checks['contextRestore']
            assert checks['contextRestore']['glError']==0,checks['contextRestore']['glError']
            page.bring_to_front()
            page.locator('[data-act="resume"]:visible').click()
            try:
                page.wait_for_function("GH.G.state==='playing' && document.pointerLockElement===GH.debug.gfx.renderer.domElement",timeout=15000)
            except Exception:
                checks['resumeFailure']=page.evaluate('({snapshot:__frames.snapshot(),input:{locked:GH.debug.input.locked,allowLock:GH.debug.input.allowLock,attempt:GH.debug.input.lockAttempt},device:GHInput.effective,errors:__frames.errors,inputEvents:__frames.inputEvents,lockElement:document.pointerLockElement?.id,err:document.getElementById("err")?.textContent})')
                page.screenshot(path=str(OUT/(name+'-failure.png')))
                raise
            # Normal-AI smoke can resume while dead. A key sent during death is
            # correctly ignored; wait for native respawn/draw before testing it.
            page.wait_for_function("GH.G.state==='playing' && GH.debug.player.alive && GH.debug.arsenal.state==='ready'",timeout=20000)
            checks['equipmentBefore']=page.evaluate('({alive:GH.debug.player.alive,state:GH.debug.arsenal.state,slot:GH.debug.arsenal.cur})')
            page.keyboard.press('2')
            page.wait_for_function('GH.debug.arsenal.cur===1',timeout=10000)
            page.evaluate('async()=>{await GH.debug.gfx.whenReady();}')
            checks['equipment']=page.evaluate('({slot:GH.debug.arsenal.cur,visible:GH.debug.vm.gun?.root?.visible,guns:Object.keys(GH.debug.vm.guns)})')
            assert checks['equipment']['slot']==1,checks['equipment']
            assert checks['equipment']['visible'],checks['equipment']
            page.wait_for_timeout(1000)
            page.screenshot(path=str(OUT/(name+'-restored.png')))
            result['functional']=checks
        result['beforeReload']=page.evaluate('__frames.snapshot()')
        if args.gl_delete_audit:
            result['glDeleteAudit']=page.evaluate('__glDeleteAudit')
            assert not result['glDeleteAudit']['failures'] and not result['glDeleteAudit']['precedingErrors'],result['glDeleteAudit']
        result['measurement']=page.evaluate('__frames')
        if args.diagnostic: result['diagnostic']=page.evaluate('__diag.export()')
        if args.render_dev and 'renderDev' not in result:
            result['renderDev']=page.evaluate('renderDev.export()')
            page.evaluate('renderDev.stop()')
        if args.profile:
            (OUT/(name+'.cpuprofile')).write_text(json.dumps(profiler.send('Profiler.stop')['profile']),encoding='utf8')
        page.screenshot(path=str(OUT/(name+'.png')))
        page.reload(wait_until='domcontentloaded')
        ready(page)
        result['warm']=page.evaluate('__frames.snapshot()')
        browser.close()
        result['ok']=True
except Exception as error:
    result['failure']=repr(error)
    raise
finally:
    try:
        (OUT/(name+'.json')).write_text(json.dumps(result,ensure_ascii=False,default=str),encoding='utf8')
    finally:
        if proc.poll() is None:
            subprocess.run(['taskkill','/T','/F','/PID',str(proc.pid)],capture_output=True)
        log.close()
