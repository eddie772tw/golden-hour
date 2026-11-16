"""Analyze raw full-AI native-loop runs; no browser or plotting dependencies."""
import argparse
import json
import math
import statistics
from pathlib import Path


EXPORT_KEYS = ('manifest', 'seed', 'equipment', 'decisionTrace', 'events',
               'checkpoints', 'state', 'coverage')


def frame_stats(intervals):
    values = sorted(intervals)
    if not values or any(not math.isfinite(x) or x <= 0 for x in values):
        raise ValueError('Expected positive finite submitted-frame intervals')
    tail = values[-math.ceil(len(values) * .01):]
    return {
        'frames': len(values), 'fps': 1000 / statistics.mean(values),
        'onePercentLowFPS': 1000 / statistics.mean(tail),
        'onePercentTailFrames': len(tail),
        'p95Ms': values[math.ceil(.95 * len(values)) - 1],
        'p99Ms': values[math.ceil(.99 * len(values)) - 1],
        'reciprocalP99FPS': 1000 / values[math.ceil(.99 * len(values)) - 1],
        'maxMs': values[-1],
        'over50PerMinute': sum(x > 50 for x in values) * 60000 / sum(values),
        'over100': sum(x > 100 for x in values),
    }


def analyze(raw, baseline=None):
    assert raw['ok'] and not raw['consoleErrors'], 'Run failed or page errors'
    assert not raw['measurement']['errors'], 'Measurement errors'
    assert raw.get('nativeLoop'), 'Use the real native-loop full-AI mode'
    scenario = raw['scenario']
    assert scenario['done'] and scenario['tick'] == 3600
    coverage = scenario['coverage']
    assert coverage['botTicks'] == [3600] * 9
    for name in ('nav.path', 'die', 'respawn', 'addRagdoll', 'throwGrenade',
                 'grenadeExplode', 'k9.enemyTimer', 'k9.enemyThrow', 'k9._brain',
                 'k9._think', 'k9._pickTarget'):
        assert coverage['calls'][name] > 0, name
    assert coverage['k9ActiveTicks'] > 0 and sum(coverage['botDeadTicks']) > 0
    for snapshot in (raw['cold'], raw['warm']):
        assert snapshot['buffer'] == [1920, 1080] and snapshot['dpr'] == 1
        assert snapshot['quality'] == 'high' and snapshot['scale'] == 1
        assert not any(x in snapshot['renderer'].lower()
                       for x in ('swiftshader', 'llvmpipe', 'software', 'warp'))
    timing = scenario['timing']
    start, end = timing['startWallMs'], timing['endWallMs']
    windows = {'complete': [], 'warmTick301': []}
    frames = raw['measurement']['frames']
    for a, b in zip(frames, frames[1:]):
        # Both endpoints must belong to this active scenario. Do not mix in
        # setup, polling after completion, pause, reload or hidden intervals.
        if not (start <= a[0] < b[0] <= end and
                a[3] == b[3] == 'scripted' and
                a[4] == b[4] == 'playing' and not a[5] and not b[5]):
            continue
        windows['complete'].append(b[0] - a[0])
        if a[11] >= 301 and b[11] >= 301:
            windows['warmTick301'].append(b[0] - a[0])
    diagnostic = any(raw.get(k) for k in
                     ('profiler', 'trace', 'gpuTimer', 'osSampler', 'deepRender', 'renderDev', 'programAuditDiagnostic', 'materialInventoryDiagnostic', 'postScenarioDiagnostic', 'skeletonProbeDiagnostic', 'chairObserveDiagnostic', 'cueAuditDiagnostic', 'developerProbeDiagnostic', 'dryGate', 'gcProbeDiagnostic'))
    exports = {k: scenario[k] == baseline['scenario'][k] for k in EXPORT_KEYS} if baseline else None
    if exports is not None:
        assert all(exports.values()), exports
    wall_seconds = (end - start) / 1000
    delta = timing['loopStatsDelta']
    output = {
        'name': raw['name'], 'coreSHA256': raw['coreSHA256'],
        'diagnosticOnly': diagnostic,
        'wallSeconds': wall_seconds,
        'logicalHz': delta['logicalTicks'] / wall_seconds,
        'renderHz': delta['playingRenders'] / wall_seconds,
        'overflowDroppedMs': delta['dropped'] * 1000,
        'windows': {k: frame_stats(v) for k, v in windows.items()},
        'logicalExportsEqual': exports,
        'limits': 'Render submission intervals, not physical presents. Complete window includes first use; warm is supplemental. 1% low uses the mean of the slowest ceil(N*.01) intervals, not reciprocal P99.',
    }
    output['onePercentGatePassed'] = (
        not diagnostic and output['windows']['complete']['onePercentLowFPS'] > 45)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raw', nargs='*', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        result = frame_stats([10] * 99 + [100])
        assert result['onePercentLowFPS'] == 10
        assert result['reciprocalP99FPS'] == 100
        assert result['onePercentTailFrames'] == 1
        result = frame_stats([10] * 100 + [50])
        assert result['onePercentTailFrames'] == 2
        assert result['onePercentLowFPS'] == 1000 / 30
        print('frame statistics self-test passed')
    else:
        baseline = json.loads(args.baseline.read_bytes()) if args.baseline else None
        output = [analyze(json.loads(path.read_bytes()), baseline) for path in args.raw]
        text = json.dumps(output, indent=2, ensure_ascii=False)
        if args.output:
            args.output.write_text(text, encoding='utf8')
        print(text)
