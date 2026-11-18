"""Compare candidate to a baseline folder, without Blender or external packages."""
import json
import math
import struct
import sys
from pathlib import Path


def read(path):
    raw=path.read_bytes()
    magic,version,size=struct.unpack_from('<4sII',raw)
    assert magic==b'glTF' and version==2 and size==len(raw)
    j=20+struct.unpack_from('<I',raw,12)[0]
    return json.loads(raw[20:j]),raw[j+8:]


def compare(base,after):
    old,oldbin=read(base); doc,data=read(after)
    assert doc['nodes']==old['nodes'] and doc['scenes']==old['scenes']
    for k in ('materials','textures','images'):
        assert doc[k]==old[k]
    def embedded(d,b,index):
        v=d['bufferViews'][index];s=v.get('byteOffset',0)
        return b[s:s+v['byteLength']]
    for im in doc['images']:
        idx=im['bufferView'];assert embedded(doc,data,idx)==embedded(old,oldbin,idx)
    def prims(d):return [q for m in d['meshes'] for q in m['primitives']]
    prev,parts=prims(old),prims(doc);assert len(prev)==len(parts)
    for p,o in zip(parts,prev):
        assert p['material']==o['material'] and set(p['attributes'])==set(o['attributes'])
        vcount=doc['accessors'][p['attributes']['POSITION']]['count']
        for semantic,a in p['attributes'].items():
            acc=doc['accessors'][a];assert acc['count']==vcount and acc['componentType']==5126
            arr=embedded(doc,data,acc['bufferView'])
            assert len(arr)==4*vcount*{'VEC2':2,'VEC3':3}[acc['type']]
            assert all(math.isfinite(t[0]) for t in struct.iter_unpack('<f',arr))
        a=doc['accessors'][p['indices']];assert a['componentType']==5123
        assert a['count']%3==0 and max(v[0] for v in struct.iter_unpack('<H',embedded(doc,data,a['bufferView'])))<vcount
    triangles=lambda d,p:sum(d['accessors'][q['indices']]['count']//3 for q in p)
    t0,t1=triangles(old,prev),triangles(doc,parts)
    assert t1<=5000 if 'world_lod' in after.name else t1<=t0*1.06
    print(f'{after.name}: {t0} -> {t1} triangles; {len(parts)} unchanged primitives; nodes/materials/textures OK')


if __name__=='__main__':
    before,after=map(Path,sys.argv[1:])
    files=sorted(after.glob('*.glb'));assert len(files)==6
    for f in files:compare(before/f.name,f)
