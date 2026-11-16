"""Summarize raw engine callbacks and state age; never physical presentation FPS."""
import argparse
import json
import math
from pathlib import Path


def analyze(directory):
    read = lambda name: json.loads((directory / name).read_text(encoding='utf-8'))
    source, receiver, run = read('source.json'), read('receiver.json'), read('run.json')
    assert run['ok'] and not run.get('postRunSourceMismatches')
    assert run.get('sourceProvenanceAccepted', True)
    assert receiver['schema'] == 'gh-live-receiver-v1' and receiver['ok']
    fields = receiver['frameFields']
    frames = [dict(zip(fields, row)) for row in receiver['frames'] if row[fields.index('phase')] == 'live']
    stats = receiver['statistics']
    assert frames and len(frames) == stats['liveDraws']
    assert sum(row['distinctTick'] for row in frames) == stats['distinctDrawTicks']
    assert source['realtime']['actualNodeGPUFrames'] == 0

    def distribution(key):
        values = sorted(row[key] for row in frames)
        assert all(math.isfinite(value) for value in values)
        return {name: values[int((len(values)-1)*q)] for name, q in [('min', 0), ('p50', .5), ('p95', .95), ('p99', .99), ('max', 1)]}

    events = {item['event']: item['monoMs'] for item in receiver['events']}
    memory = run['memorySamples']
    return {
        'scope': 'Live original-AI skin component; engine callbacks, not physical presents or input-to-photon',
        'acceptanceEligible': False,
        'quantileMethod': 'Sorted lower order statistic at floor((N-1)*q); all live callbacks retained',
        'fullFixturePassed': source['fullFixturePassed'],
        'logicHz': source['realtime']['logicalHz'],
        'sourceSnapshotHz': source['realtime']['sourceSnapshotHz'],
        'droppedDebtSeconds': source['realtime']['droppedDebtSeconds'],
        'engineDrawCallbacks': len(frames),
        'distinctDrawTicks': stats['distinctDrawTicks'],
        'staleDrawRatio': stats['staleDraws']/len(frames),
        'engineCallbackIntervalMs': distribution('intervalMs'),
        'estimatedStateAgeMs': distribution('estimatedStateAgeMs'),
        'clock': receiver['clock'],
        'callbackLongCounts': {str(limit): sum(row['intervalMs'] > limit for row in frames) for limit in [1000/30, 50, 100]},
        'focusedCallbacks': sum(row['focusedAtDraw'] for row in frames),
        'minimizedCallbacks': sum(row['minimizedAtDraw'] for row in frames),
        'startSentToFirstLiveCallbackMs': events['first-live-draw']-events['start-sent'],
        'ownedTreePeakRSSBytes': max(row[2] for row in memory),
        'ownedTreePeakPrivateBytes': max(row[3] for row in memory),
        'memoryDefinition': run['memoryDefinition'],
        'coldDefinition': run['coldDefinition'],
        'gpuTimeMs': None,
        'fullHighParity': receiver['fullHighParity'],
        'fullScene': receiver['fullScene'],
        'audioOutput': receiver['audioOutput'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    print(json.dumps(analyze(parser.parse_args().directory), indent=2))
