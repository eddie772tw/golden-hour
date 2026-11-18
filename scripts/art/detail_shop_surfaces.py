"""Blender art pass over the shape-key study: soft relief and near-camera bevels.
Usage: blender -b -P detail_shop_surfaces.py -- INPUT_DIR OUTPUT_DIR
Only display meshes change. Repack existing views to avoid retaining obsolete data.
"""
import bpy, bmesh, json, struct, sys, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path


def detail(src,dst):
    r=src.read_bytes(); j=20+struct.unpack_from('<I',r,12)[0]; d=json.loads(r[20:j])
    views=[r[j+8+v.get('byteOffset',0):j+8+v.get('byteOffset',0)+v['byteLength']] for v in d['bufferViews']]
    model=src.stem.split('_')[0]; near='world' not in src.stem
    def fmt(a):
        return '<'+{'SCALAR':'','VEC2':'2','VEC3':'3'}[a['type']]+{5123:'H',5126:'f'}[a['componentType']]
    def load(i):
        a=d['accessors'][i];f=fmt(a);s=a.get('byteOffset',0);return list(struct.iter_unpack(f,views[a['bufferView']][s:s+a['count']*struct.calcsize(f)]))
    def write(i,arr):
        a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];f=fmt(a)
        assert not a.get('byteOffset') and struct.calcsize(f)*a['count']==len(views[a['bufferView']])
        views[a['bufferView']]=b''.join(struct.pack(f,*item) for item in arr);a['count']=len(arr);v['byteLength']=len(views[a['bufferView']])
        for k,fn in [('min',min),('max',max)]:
            if k in a:a[k]=[fn(row[col] for row in arr) for col in range(len(arr[0]))]
    for mesh in d['meshes']:
        for p in mesh['primitives']:
            mat=d['materials'][p['material']]['name']; a=p['attributes']
            shell=(model=='gbull' and mat=='Dark anodized frame' or model=='linbei' and mat=='04 Black recoil rubber' or model=='chingi' and mat=='Grip edge satin polymer')
            bevel=near and ('OpenIrons' in mesh['name'] or ('RaisedBead' in mesh['name'] and 'graphite' in mat))
            panel=near and mesh==d['meshes'][0] and (
                (model=='chingi' and mat=='Satin graphite steel') or
                (model=='linbei' and mat=='01 Satin blued graphite') or
                (model=='gbull' and mat=='Satin graphite steel'))
            if not (shell or bevel or panel):continue
            pos=load(a['POSITION']);idx=[v[0] for v in load(p['indices'])];tri=list(zip(idx[::3],idx[1::3],idx[2::3]));norm=load(a['NORMAL'])
            if bevel:
                assert set(a)=={'POSITION','NORMAL'}
                bm=bmesh.new()
                vs=[bm.verts.new(co) for co in pos]
                for t in tri: bm.faces.new([vs[i] for i in t])
                bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bm.normal_update()
                sharp=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.5]
                if not sharp:bm.free();continue
                bmesh.ops.bevel(bm,geom=sharp,offset=.00022,segments=2,affect='EDGES',clamp_overlap=True)
                bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.normal_update()
                pos=[];norm=[];idx=[];seen={}
                for face in bm.faces:
                    n=tuple(face.normal)
                    for v in face.verts:
                        key=tuple(v.co)+n
                        if key not in seen:seen[key]=len(pos);pos.append(key[:3]);norm.append(n)
                        idx.append(seen[key])
                bm.free()
            else:
                # Shallow, rounded chevrons following the existing outer face.
                # Negative space between marks reads at distance without tiny bolts.
                surf=BVHTree.FromPolygons(pos,tri,all_triangles=True)
                config={'gbull':(-.088,-.042,.0095,.0007,7),'chingi':(-.091,-.042,.012,.0012,6),
                        'linbei':(-.104,-.014,.017,.0014,9)}[model]
                if panel:
                    # Broad sculpted back-cap grooves are read from the first-person
                    # camera. They stay on side cheeks, below the central sightline.
                    config={'gbull':(.006,.019,.013,.00065,4),
                            'chingi':(.008,.037,.020,.00110,5),
                            'linbei':(.020,.058,.018,.00115,6)}[model]
                low,high,width,relief,nrows=config
                extra=[]
                for row in range(nrows if near else (nrows+1)//2):
                    y=low+(high-low)*row/max(1,(nrows if near else (nrows+1)//2)-1)
                    pts=[];faces=[];nc=9 if near else 5
                    for col in range(nc):
                        t=col/(nc-1)*2-1;half=relief*(.55+.45*(1-abs(t)))
                        for k in [-1,0,1]:
                            xx=t*width
                            yy=y+(1-abs(t))*(.0038 if panel else .0025)+k*half
                            h=surf.ray_cast((xx,yy,1),(0,0,-1))[0]
                            if h is None:break
                            # On a fragmented surface don't connect across the entire
                            # mesh to a different island behind a missing sample.
                            if panel and h.z<{'gbull':.065,'chingi':.115,'linbei':.005}[model]:break
                            pts.append(Vector((xx,yy,h.z+(relief if k==0 else -.00008)*(.5+.5*(1-abs(t))))))
                    if len(pts)!=nc*3:continue
                    for c in range(nc-1):
                        for k in range(2):
                            i=c*3+k;faces.extend([(i,i+3,i+4),(i,i+4,i+1)])
                    b=len(pos);pos.extend(map(tuple,pts));nv=[Vector((0,0,0)) for _ in pts]
                    for t in faces:
                        i,k,l=t;v=(pts[k]-pts[i]).cross(pts[l]-pts[i]);idx.extend(b+s for s in t)
                        for s in t:nv[s]+=v
                    norm.extend(tuple(v.normalized()) for v in nv);extra.extend(pts)
                for key,i in a.items():
                    if key.startswith('TEXCOORD'):
                        uv=load(i);uv.extend((0.,0.) for _ in extra);write(i,uv)
            write(a['POSITION'],pos);write(a['NORMAL'],norm);write(p['indices'],[(v,) for v in idx])
    packed=bytearray()
    for view,blob in zip(d['bufferViews'],views):
        packed.extend(bytes(-len(packed)%4));view['byteOffset']=len(packed);packed.extend(blob)
    d['buffers'][0]['byteLength']=len(packed);packed.extend(bytes(-len(packed)%4))
    js=json.dumps(d,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    body=struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(packed),b'BIN\0')+packed
    dst.write_bytes(struct.pack('<4sII',b'glTF',2,len(body)+12)+body)


if __name__=='__main__':
    src,dst=map(Path,sys.argv[-2:]);dst.mkdir(exist_ok=True,parents=True)
    for f in sorted(src.glob('*.glb')):detail(f,dst/f.name)
