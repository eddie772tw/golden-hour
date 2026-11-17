"""Stream a large CDP trace and report bounded, explicitly attributed events."""
import argparse
import collections
import hashlib
import json
from pathlib import Path


def events(path, chunk=1024*1024):
    decoder = json.JSONDecoder()
    with path.open(encoding='utf8') as stream:
        buf = stream.read(chunk)
        while True:
            marker = buf.find('"traceEvents"')
            opening = buf.find('[', marker + len('"traceEvents"')) if marker >= 0 else -1
            if opening >= 0:
                pos = opening + 1
                break
            more = stream.read(chunk)
            if not more:
                raise ValueError('Missing traceEvents')
            buf += more
        eof = False
        while True:
            while pos < len(buf) and buf[pos] in ' \n\r\t,':
                pos += 1
            if pos < len(buf) and buf[pos] == ']':
                return
            try:
                row, end = decoder.raw_decode(buf, pos)
            except json.JSONDecodeError:
                if eof:
                    raise
                more = stream.read(chunk)
                eof = not more
                buf, pos = buf[pos:] + more, 0
                continue
            pos = end
            yield row


def analyze(trace, run):
    threads, processes, marks, candidates = {}, {}, {}, []
    names = collections.Counter()
    count = 0
    for e in events(trace):
        count += 1
        name, args = e.get('name', ''), e.get('args', {})
        names[name] += 1
        identity = (e.get('pid'), e.get('tid'))
        if name == 'thread_name':
            threads[identity] = args.get('name')
        if name == 'process_name':
            processes[e.get('pid')] = args.get('name')
        if name in ('gh-thread-window-start', 'gh-thread-window-end'):
            if name in marks:
                raise ValueError('Ambiguous trace marker: '+name)
            marks[name] = e
        if e.get('ph') == 'X' and (e.get('dur', 0) >= 10000 or name == 'MajorGC'
                or args.get('src_func') == 'RequestToDeleteHandlersOnMainThread'):
            candidates.append(e)
    start, end = marks['gh-thread-window-start'], marks['gh-thread-window-end']
    owner = (start['pid'], start['tid'])
    assert owner == (end['pid'], end['tid']) and end['ts'] > start['ts']
    low, high = start['ts'], end['ts']
    selected, partial, seen, mirrors = [], [], set(), 0
    for e in candidates:
        ts, finish = e['ts'], e['ts']+e.get('dur', 0)
        if not ts < high or not finish > low:
            continue
        args = e.get('args', {})
        identity = (e['pid'], e['tid'], e['name'], ts, e.get('dur'), args.get('src_func'))
        if identity in seen:
            continue
        seen.add(identity)
        row = {'name': e['name'], 'pid': e['pid'], 'tid': e['tid'],
               'thread': threads.get((e['pid'], e['tid'])), 'process': processes.get(e['pid']),
               'atMS': (ts-low)/1000, 'wallMS': e.get('dur', 0)/1000,
               'threadMS': e['tdur']/1000 if 'tdur' in e else None,
               'sourceFile': args.get('src_file'), 'sourceFunction': args.get('src_func')}
        if not low <= ts <= finish <= high:
            partial.append(row)
            continue
        if e['name'] == 'Edge_RunTask':
            mirrors += 1
            continue
        selected.append(row)
    main = [r for r in selected if (r['pid'], r['tid']) == owner]
    deletion = [r for r in main if r['name'] == 'ThreadControllerImpl::RunTask'
                and r['sourceFunction'] == 'RequestToDeleteHandlersOnMainThread']
    gc = [r for r in main if r['name'] == 'MajorGC']
    def totals(rows):
        return {'count': len(rows), 'wallMS': sum(r['wallMS'] for r in rows),
                'maxWallMS': max((r['wallMS'] for r in rows), default=None),
                'maxThreadMS': max((r['threadMS'] for r in rows if r['threadMS'] is not None), default=None)}
    data = json.loads(run.read_bytes())
    with trace.open('rb') as stream:
        trace_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'schema': 1, 'name': data['name'], 'diagnosticOnly': True,
            'coreSHA256': data['coreSHA256'], 'traceSHA256': trace_hash,
            'traceBytes': trace.stat().st_size, 'events': count, 'categories': data.get('traceCategories'),
            'windowMS': (high-low)/1000, 'pageMain': {'pid': owner[0], 'tid': owner[1], 'thread': threads.get(owner)},
            'nativeAudioDeletion': totals(deletion), 'exactMajorGC': totals(gc),
            'largestNativeAudioDeletion': sorted(deletion, key=lambda r:r['wallMS'], reverse=True)[:8],
            'majorGCEvents': gc,
            'largestMainTasks': sorted((r for r in main if r['name']=='ThreadControllerImpl::RunTask'),
                                       key=lambda r:r['wallMS'], reverse=True)[:16],
            'largestPageMainEvents': sorted(main, key=lambda r:r['wallMS'], reverse=True)[:32],
            'largestOtherThreadEvents': sorted((r for r in selected if (r['pid'], r['tid']) != owner),
                                              key=lambda r:r['wallMS'], reverse=True)[:16],
            'partialBoundaryCount': len(partial), 'ignoredEdgeTaskMirrors': mirrors,
            'commonEventNames': names.most_common(16),
            'limits': 'Complete X events in the explicit trace window; parent/child events overlap and must not be added. Audio deletion uses canonical RunTask sourceFunction, GC uses exact MajorGC only. Wall durations can include waits; tdur is separately recorded. Trace and render observers add uncalibrated overhead. No physical display/audio proof.'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('trace', type=Path)
    p.add_argument('run', type=Path)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    result = analyze(a.trace, a.run)
    a.output.write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps({k: result[k] for k in ['events','windowMS','pageMain','nativeAudioDeletion','exactMajorGC','commonEventNames']}, indent=2))
