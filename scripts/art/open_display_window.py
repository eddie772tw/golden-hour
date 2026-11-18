"""Blender art pass: cut a blind display pocket in the Lin-Bei game prop.
No functional internals: the recess is only a shallow theatrical backdrop.
Run after the silhouette/detail passes. Blender coordinates are glTF-local here.
"""
import json, struct, sys
from pathlib import Path
from mathutils import Vector

# Polygon of the stylised panel, in existing asset space (z, y).
outline=[(-.140,.039),(-.136,.035),(-.073,.035),(-.062,.042),
         (-.062,.056),(-.068,.063),(-.130,.063),(-.140,.056)]


def open_window(src,dst):
    raw=src.read_bytes();j=20+struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:j])
    views=[raw[j+8+v.get('byteOffset',0):j+8+v.get('byteOffset',0)+v['byteLength']] for v in d['bufferViews']]
    def fmt(a):return '<'+{'SCALAR':'','VEC2':'2','VEC3':'3'}[a['type']]+{5126:'f',5123:'H'}[a['componentType']]
    def load(i):
        a=d['accessors'][i];return list(struct.iter_unpack(fmt(a),views[a['bufferView']]))
    def save(i,arr):
        a=d['accessors'][i];k=a['bufferView'];views[k]=b''.join(struct.pack(fmt(a),*row) for row in arr);d['bufferViews'][k]['byteLength']=len(views[k]);a['count']=len(arr)
        for k,op in [('min',min),('max',max)]:
            if k in a:a[k]=[op(row[c] for row in arr) for c in range(len(arr[0]))]
    planes=[(1,0,0,-.003)]
    for (z,y),(Z,Y) in zip(outline,outline[1:]+outline[:1]):
        az,ay=Z-z,Y-y
        planes.append((0,az,-ay,ay*z-az*y))
    def split(poly,plane):
        yes=[];no=[]
        nx,ny,nz,w=plane
        def side(a):x,y,z=a[:3];return nx*x+ny*y+nz*z+w
        for a,b in zip(poly,poly[1:]+poly[:1]):
            fa,fb=side(a),side(b)
            (yes if fa>=0 else no).append(a)
            if (fa>=0)!=(fb>=0):
                t=fa/(fa-fb);pt=tuple(u+(v-u)*t for u,v in zip(a,b));yes.append(pt);no.append(pt)
        return yes,no
    def triangles(poly):
        for i in range(1,len(poly)-1):
            vs=[poly[0],poly[i],poly[i+1]]
            if (Vector(vs[1][:3])-Vector(vs[0][:3])).cross(Vector(vs[2][:3])-Vector(vs[0][:3])).length_squared>1e-21:yield vs
    for p in d['meshes'][0]['primitives']:
        name=d['materials'][p['material']]['name']
        if not any(k in name.lower() for k in ['graphite','recess','brushed cool']):continue
        attrs=p['attributes']; keys=['POSITION','NORMAL']+[k for k in attrs if k not in ('POSITION','NORMAL')]
        arrays=[load(attrs[k]) for k in keys];dims=[len(a[0]) for a in arrays];idx=[v[0] for v in load(p['indices'])]
        vertex=[sum(vals,()) for vals in zip(*arrays)]
        new=[];ii=[];lookup={}
        def emit(verts):
            for row in verts:
                key=tuple(round(v,9) for v in row)
                if key not in lookup:lookup[key]=len(new);new.append(row)
                ii.append(lookup[key])
        for tri in zip(idx[::3],idx[1::3],idx[2::3]):
            poly=[vertex[i] for i in tri]
            xs,ys,zs=zip(*[v[:3] for v in poly])
            # Existing applied solid panel is a separate island; clear it fully.
            if ('recess' in name.lower() or 'brushed cool' in name.lower()) and min(xs)>.016 and min(ys)>.027 and max(ys)<.074 and min(zs)>-.155 and max(zs)<-.05:continue
            if max(xs)<.003 or max(ys)<.035 or min(ys)>.063 or max(zs)<-.140 or min(zs)>-.062:
                emit(poly);continue
            for plane in planes:
                inside,outside=split(poly,plane)
                for q in triangles(outside):emit(q)
                poly=inside
                if len(poly)<3:break
        if 'recess' in name.lower():
            # Recessed dark backing and wall make a genuine open exterior, not
            # a hole through both sides of the asset. Shell is a client prop.
            rear=[(.002,y,z) for z,y in outline]; front=[(.0192,y,z) for z,y in outline]
            def face(pts):
                vv=[Vector(t) for t in pts];n=(vv[1]-vv[0]).cross(vv[2]-vv[0]).normalized()
                anchor=[tuple(v)+tuple(n)+(0.,)*(sum(dims)-6) for v in vv]
                for t in triangles(anchor):emit(t)
            face(list(reversed(rear)))
            for i in range(len(outline)):
                k=(i+1)%len(outline);face([front[k],rear[k],rear[i],front[i]])
        offset=0
        for k,n in zip(keys,dims):
            values=[v[offset:offset+n] for v in new]
            if k=='NORMAL':values=[tuple(Vector(v).normalized()) for v in values]
            save(attrs[k],values);offset+=n
        save(p['indices'],[(i,) for i in ii])
    buf=bytearray()
    for v,b in zip(d['bufferViews'],views):buf.extend(bytes(-len(buf)%4));v['byteOffset']=len(buf);buf.extend(b)
    d['buffers'][0]['byteLength']=len(buf);buf.extend(bytes(-len(buf)%4))
    js=json.dumps(d,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    body=struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(buf),b'BIN\0')+buf
    dst.write_bytes(struct.pack('<4sII',b'glTF',2,len(body)+12)+body)

if __name__=='__main__':
    base,dest=map(Path,sys.argv[-2:]);dest.mkdir(exist_ok=True,parents=True)
    for f in sorted(base.glob('linbei*.glb')):open_window(f,dest/f.name)
