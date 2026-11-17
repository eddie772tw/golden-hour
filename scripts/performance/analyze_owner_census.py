"""Summarize a diagnostic pass/owner census without projecting FPS savings."""
import argparse
import collections
import hashlib
import json
import statistics
from pathlib import Path
from analyze_browser import analyze


def summarize(path, baseline):
    raw = path.read_bytes()
    data = json.loads(raw)
    validation = analyze(data, baseline)
    assert validation['diagnosticOnly'], 'Never present a census as clean FPS'
    census = data['ownerCensus']
    assert census['frames'] > 0 and census['conflicts'] == 0
    assert sum(r['Dcalls'] for r in census['table']) > 0
    totals = collections.defaultdict(lambda: collections.defaultdict(float))
    for row in census['table']:
        for key, value in row.items():
            if isinstance(value, (int, float)):
                totals[row['owner']][key] += value
    owners = []
    for name, values in totals.items():
        owners.append({'owner': name, **values,
                       'drawsPerFrame': values['draws']/census['frames'],
                       'trianglesPerFrame': values['triangles']/census['frames'],
                       'parametersPerFrame': values['parameters']/census['frames'],
                       'sampledDrawMeanMS': values['drawWallMS']/values['drawTimed'] if values['drawTimed'] else None,
                       'sampledUploadMeanMS': values['uploadWallMS']/values['uploadTimed'] if values['uploadTimed'] else None})
    gpu = collections.defaultdict(list)
    observer = data.get('renderDev', {})
    assert not observer.get('errors'), 'Render observer errors'
    for row in observer.get('gpu', []):
        if 0 < (row.get('tick') or 0) < 3600:
            gpu[row['label']].append(row['ms'])
    return {'schema': 1, 'diagnosticOnly': True, 'name': data['name'],
            'rawPath': str(path), 'rawSHA256': hashlib.sha256(raw).hexdigest(),
            'coreSHA256': data['coreSHA256'], 'browserVersion': data['browserVersion'],
            'logicalExportsEqual': validation['logicalExportsEqual'],
            'version': census['version'], 'frames': census['frames'],
            'owners': sorted(owners, key=lambda r: r['bufferBytes'], reverse=True),
            'passOwner': census['table'], 'passes': census['passes'],
            'gpu': {k: {'samples': len(v), 'meanMS': statistics.mean(v), 'maxMS': max(v)} for k, v in gpu.items()},
            'limits': census['limits'] + [
                'Shadow invocation counts include empty calls from postprocess renders; owner draws measure actual submissions.',
                'GPU intervals are sparse, inclusive and overlapping; never add child scopes to parents.',
                'No projected savings, per-owner GPU cost or clean FPS conclusion follows from this diagnostic.']}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('raw', type=Path)
    p.add_argument('--baseline', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    result = summarize(a.raw, json.loads(a.baseline.read_bytes()))
    if a.output.exists():
        raise RuntimeError('Refusing to overwrite evidence')
    a.output.write_bytes((json.dumps(result, indent=2) + '\n').encode())
    print(json.dumps({'name': result['name'], 'frames': result['frames'], 'owners': len(result['owners']),
                      'strict': result['logicalExportsEqual']}, indent=2))
