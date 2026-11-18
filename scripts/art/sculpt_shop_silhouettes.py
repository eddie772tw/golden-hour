"""Blender 3.4+ shape-key study, external silhouettes only.
blender -b -P scripts/art/sculpt_shop_silhouettes.py -- BASELINE_DIR OUTPUT_DIR BLEND_DIR
The original binary container is retained because the game's minimal loader does
not accept arbitrary Blender glTF exports. Each primitive is a Blender mesh;
read its evaluated shape back without re-indexing UV seams or changing sockets.
"""
import bpy
import json
import math
import struct
import sys
from mathutils import Vector, Matrix
from pathlib import Path


def ease(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)


def profile(model, v, body_surface=True):
    # Local glTF: y up. Broad form only. All material islands share the same
    # envelope so screws, seams and overlays stay together with their surface.
    x,y,z=v
    if model=='gbull':
        w=ease(.025,.048,z)*(1-ease(-.048,-.014,y))
        waist=math.exp(-((y+.062)/.024)**2)
        z+=w*(.003*waist-.004*ease(.072,.104,-y)) * (2*ease(.055,.082,z)-1)
        x*=1+w*(.13*waist-.1*ease(.074,.101,-y))
        # The pistol's swept panels are not the vertical stamped grip used on
        # the SMG. Wrap their fore/aft edges into the backstrap along the rake.
        center=.055-.29*y
        span=min(1,abs(z-center)/.025)
        panel=ease(.030,.048,z)*(1-ease(.097,.108,z))*ease(-.109,-.096,y)*(1-ease(-.031,-.015,y))
        x*=1+panel*(.12*waist-.32*span*span-.06*(1-waist))
        z+=panel*(center-z)*.21*ease(.006,.016,abs(x))
        # Roll the two exterior cheeks, leaving the center barrel and safety
        # inserts outside of the deformation field.
        shell=ease(-.098,-.073,z)*(1-ease(.077,.088,z))*ease(.001,.006,y)*(1-ease(.025,.028,y))
        corner=ease(.008,.014,abs(x))
        x*=1-.16*shell*ease(.014,.025,y)*corner
        y-=.0016*shell*corner*ease(.016,.024,y)

    elif model=='chingi':
        # Make the folded sheet silhouette less uniformly boxy; retain top line.
        w=ease(-.176,-.12,z)*(1-ease(.10,.147,z))*ease(-.024,-.004,y)
        # The full-size reference has a rectilinear shell, but not a square
        # extrusion: carry its folded shoulder highlight around both end caps.
        if not body_surface:
            # Preserve the previously verified iron assembly exactly.
            return Vector((x*(1-.12*w*ease(.014,.043,y)),y,z))
        casing=ease(-.191,-.169,z)*(1-ease(.151,.166,z))
        shoulder=ease(.026,.046,y)*(1-ease(.049,.063,y))
        heel=(1-ease(-.012,.001,y))*ease(-.026,-.012,y)
        x*=1-casing*(.17*shoulder+.095*heel)
        y-=casing*.0040*shoulder*ease(.011,.020,abs(x))
        # Roll the broad corner bevels back at the ends; the center face,
        # centerline and separate sight assemblies do not move.
        endface=(1-ease(-.174,-.150,z))-ease(.130,.151,z)
        z+=casing*endface*.0060*ease(.012,.020,abs(x))
        # Give the original vertical handgrip a rounded section and a palm
        # swell. The shaping field also carries its molded panels and inserts.
        grip=ease(-.021,-.006,z)*(1-ease(.057,.072,z))*ease(-.127,-.108,y)*(1-ease(-.035,-.018,y))
        mid=math.exp(-((y+.072)/.025)**2)
        edge=min(1,abs((z-.024)/.032))
        x*=1+grip*(.18*mid-.32*edge*edge-.085*(1-mid))
        z+=grip*((.024-z)*.22*ease(.007,.019,abs(x))+
                 .008*ease(.043,.111,-y)-.003*mid)

        # Shape the visible outer polymer panels rather than add microgeometry.
        panel=ease(-.16,-.14,z)*(1-ease(-.055,-.039,z))
        x*=1+.13*panel*(1-ease(.003,.028,y))
        y-=.004*panel*(1-ease(-.008,.02,y))*ease(-.06,-.027,y)
    elif model=='linbei':
        # Re-contour the wooden comb and belly; keep full length, butt plate and wrist.
        w=ease(.076,.155,z)*(1-ease(.26,.35,z))
        y+=w*(.009*ease(-.085,-.025,y)-.004*(1-ease(-.085,-.025,y)))
        x*=1+w*(.18*ease(-.09,-.025,y)-.06)
        # Shape the forward walnut as a separate hand-carved volume: softly
        # rolled sides taper into the ferrules; do not shorten the wood.
        wood=ease(-.380,-.361,z)*(1-ease(-.201,-.188,z))*ease(-.025,-.014,y)*(1-ease(.042,.050,y))
        lengthwise=math.exp(-((z+.280)/.056)**2)
        x*=1+wood*(.16*lengthwise-.12-.10*ease(.015,.042,y))
        y+=wood*ease(.008,.023,abs(x))*(.003*(1-ease(-.009,.013,y))-.0035*ease(.016,.040,y))
        # Blend the wrist into the broader comb rather than treating all wood
        # as one box. Keep the original butt plate, full length and centerline.
        wrist=ease(.027,.062,z)*(1-ease(.13,.203,z))
        x*=1+wrist*(-.18+.24*ease(-.07,-.015,y))
        y+=wrist*.006*ease(.004,.020,abs(x))*ease(-.078,-.012,y)
        # The receiver's top rim catches light without moving the sight, bore
        # silhouette, upper mount center or separate removable iron assembly.
        receiver=ease(-.175,-.155,z)*(1-ease(.022,.045,z))*ease(.040,.066,y)*(1-ease(.076,.081,y))
        rim=ease(.008,.020,abs(x))
        x*=1-.16*receiver*rim
        y-=.0045*receiver*rim

    return Vector((x,y,z))


def sculpt(src,dest,blend):
    raw=bytearray(src.read_bytes())
    end=20+struct.unpack_from('<I',raw,12)[0]
    d=json.loads(raw[20:end]); start=end+8
    def offset(a):
        v=d['bufferViews'][a['bufferView']]
        return start+v.get('byteOffset',0)+a.get('byteOffset',0)
    def unpack(i,fmt):
        a=d['accessors'][i]
        return list(struct.iter_unpack(fmt,raw[offset(a):offset(a)+a['count']*struct.calcsize(fmt)]))
    model=src.stem.split('_')[0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats=[]
    for m in d['materials']:
        mat=bpy.data.materials.new(m['name'])
        mat.diffuse_color=m['pbrMetallicRoughness'].get('baseColorFactor',[.26,.105,.042,1])
        mats.append(mat)
    changed=0
    for mesh in d['meshes']:
        body_surface=mesh is d['meshes'][0]
        for k,p in enumerate(mesh['primitives']):
            a=p['attributes']; pos=unpack(a['POSITION'],'<3f')
            idx=[t[0] for t in unpack(p['indices'],'<H')]
            me=bpy.data.meshes.new(mesh['name']+str(k))
            me.from_pydata(pos,[],list(zip(idx[::3],idx[1::3],idx[2::3])));me.update()
            obj=bpy.data.objects.new(mats[p['material']].name,me);bpy.context.collection.objects.link(obj)
            obj.data.materials.append(mats[p['material']])
            obj.shape_key_add(name='Original')
            key=obj.shape_key_add(name='External silhouette study')
            for v,pt in zip(pos,key.data): pt.co=profile(model,v,body_surface)
            key.value=1
            # Blender Z-up editor display; shape-key coordinates remain in glTF local space.
            obj.rotation_euler.x=math.pi/2
            bpy.context.view_layer.update()
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
            coords=[v.co.copy() for v in evaluated.vertices]
            for semantic,fmt in [('POSITION','<3f'),('NORMAL','<3f')]:
                acc=d['accessors'][a[semantic]]; off=offset(acc)
                if semantic=='POSITION':
                    vectors=coords
                    acc['min']=[min(v[i] for v in vectors) for i in range(3)]
                    acc['max']=[max(v[i] for v in vectors) for i in range(3)]
                else:
                    vectors=[]
                    for point,n in zip(pos,unpack(a[semantic],fmt)):
                        # Transport authored split normals through the local shape
                        # derivative. Keep hard/smooth shading boundaries intact.
                        q=Vector(point); eps=.00001
                        cols=[(profile(model,q+axis*eps,body_surface)-profile(model,q-axis*eps,body_surface))/(2*eps)
                              for axis in (Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1)))]
                        vectors.append((Matrix(cols).inverted_safe()@Vector(n)).normalized())
                for i,v in enumerate(vectors):struct.pack_into(fmt,raw,off+12*i,*v)
            changed+=sum((Vector(v)-w).length>.00001 for v,w in zip(pos,coords))
    assert changed>0
    js=json.dumps(d,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    body=struct.pack('<I4s',len(js),b'JSON')+js+raw[end:]
    dest.write_bytes(struct.pack('<4sII',b'glTF',2,len(body)+12)+body)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print(src.stem,'edited vertices',changed,flush=True)


if __name__=='__main__':
    base,out,blends=map(Path,sys.argv[-3:])
    out.mkdir(parents=True,exist_ok=True);blends.mkdir(parents=True,exist_ok=True)
    for f in sorted(base.glob('*.glb')):sculpt(f,out/f.name,blends/(f.stem+'.blend'))
