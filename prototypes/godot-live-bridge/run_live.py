"""Root-owned live Node/Godot component run; no full High acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import psutil

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--packet', type=Path, default=HERE.parent/'godot-skin-component/evidence/operators.skin.json')
    parser.add_argument('--ticks', type=int, default=120)
    parser.add_argument('--port', type=int, default=48921)
    parser.add_argument('--producer', choices=['baseline','interval'], default='baseline')
    args = parser.parse_args()
    assert args.name.replace('-', '').replace('_', '').isalnum()
    assert 1 <= args.ticks <= 3600 and 1024 <= args.port <= 65535
    out = HERE / 'evidence' / args.name
    engine = str(args.engine.resolve())
    assert Path(engine).is_file() and args.packet.is_file()
    out.mkdir(parents=True, exist_ok=False)
    producer = HERE / ('producer-baseline.mjs' if args.producer == 'baseline' else 'producer-interval.mjs')
    commands = {
        'node': ['node', str(producer), f'--port={args.port}',
                 f'--ticks={args.ticks}', '--wait-seconds=180', f'--output={out / "source.json"}'],
        'godot': [engine, '--path', str(HERE / 'receiver'), '--rendering-method', 'forward_plus',
                  '--rendering-driver', 'vulkan', '--', f'--port={args.port}',
                  f'--skin-packet={args.packet.resolve()}',
                  f'--report={out / "receiver.json"}', f'--capture={out / "capture.png"}'],
    }
    files = list(HERE.glob('*.mjs')) + list((HERE / 'receiver').glob('*.gd'))
    files += [HERE / 'receiver/project.godot', HERE / 'receiver/main.tscn']
    files.append(Path(__file__).resolve())
    if producer not in files:
        files.append(producer)
    frozen_sources = {str(p.relative_to(HERE)): p.read_bytes() for p in files}
    for name, data in frozen_sources.items():
        copy = out / 'sources' / name
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(data)
    report = {'scope': 'Live original-AI/skin-only diagnostic, not full High performance acceptance',
              'acceptanceEligible': False, 'commands': commands,
              'sourceSHA256': {name: hashlib.sha256(data).hexdigest() for name, data in frozen_sources.items()},
              'coldDefinition': 'fresh processes; OS, engine import and GPU driver caches retained',
              'memoryDefinition': 'sum of owned root/descendant RSS and Windows private committed bytes; shared RSS may double count',
              'memoryFields': ['elapsedMs', 'processes', 'rssBytes', 'privateBytes', 'threads'],
              'memorySamples': [], 'spawnEvents': [], 'ok': False}
    processes, logs = {}, []
    started = time.perf_counter()
    try:
        for owner, command in commands.items():
            log = (out / (owner + '.log')).open('wb')
            logs.append(log)
            proc = subprocess.Popen(command, cwd=HERE, stdout=log, stderr=subprocess.STDOUT)
            processes[owner] = proc
            report['spawnEvents'].append({'owner': owner, 'pid': proc.pid, 'elapsedMs': (time.perf_counter()-started)*1000})
        while any(p.poll() is None for p in processes.values()):
            assert time.perf_counter()-started < 240, 'Explicit 240s owned run limit exceeded'
            owned = {}
            for proc in processes.values():
                try:
                    parent = psutil.Process(proc.pid)
                    for child in [parent, *parent.children(recursive=True)]:
                        owned[(child.pid, child.create_time())] = child
                except psutil.NoSuchProcess:
                    pass
            rss = private = threads = 0
            for child in owned.values():
                try:
                    memory = child.memory_info()
                    rss += memory.rss
                    private += memory.private
                    threads += child.num_threads()
                except psutil.NoSuchProcess:
                    pass
            report['memorySamples'].append([(time.perf_counter()-started)*1000, len(owned), rss, private, threads])
            time.sleep(.25)
        report['exitCodes'] = {k: p.returncode for k, p in processes.items()}
        report['elapsedMs'] = (time.perf_counter()-started)*1000
        for log in logs:
            log.flush()
        errors = [line for line in (out / 'godot.log').read_text(encoding='utf-8', errors='replace').splitlines()
                  if line.startswith('ERROR:') or 'SCRIPT ERROR:' in line]
        report['engineErrors'] = errors
        report['postRunSourceMismatches'] = [name for name, data in frozen_sources.items() if (HERE / name).read_bytes() != data]
        assert not report['postRunSourceMismatches'], report['postRunSourceMismatches']
        assert all(code == 0 for code in report['exitCodes'].values()), report['exitCodes']
        assert not errors, errors[:5]
        source = json.loads((out / 'source.json').read_text(encoding='utf-8'))
        receiver = json.loads((out / 'receiver.json').read_text(encoding='utf-8'))
        assert source['ok'] and receiver['ok'] and receiver['sourceDone']['ok']
        assert source['realtime']['logicalTicks'] == args.ticks
        if args.ticks == 3600:
            assert source['fullFixturePassed'] and all(source['exportsEqual'].values())
        assert not receiver['headless'] and not receiver['fullHighParity']
        assert receiver['paletteReadbackMaxError'] < .000005
        assert receiver['captureError'] == 0 and (out / 'capture.png').stat().st_size > 1000
        report['ok'] = True
        print(json.dumps({'ok': True, 'out': str(out), 'statistics': receiver['statistics']}), flush=True)
    except Exception as error:
        report['failure'] = repr(error)
        raise
    finally:
        for proc in processes.values():
            if proc.poll() is None:
                subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True)
                proc.wait(timeout=10)
        for log in logs:
            log.close()
        (out / 'run.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
