"""Blender offline review of actual Three geometry. Not a native renderer oracle.
blender -b -t 2 --python scripts/performance/render_casing_review.py -- INPUT_JSON OUTPUT_DIR
"""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];data=json.loads(Path(args[0]).read_text());out=Path(args[1]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=64;s.cycles.use_denoising=False
s.render.resolution_x=1800;s.render.resolution_y=1100;s.render.resolution_percentage=100
s.world.color=(.18,.18,.18);s.view_settings.view_transform='AgX'
mat=bpy.data.materials.new('Brass approximation, not game shader');mat.diffuse_color=(.55,.30,.065,1);mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.55,.30,.065,1);bs.inputs['Metallic'].default_value=1;bs.inputs['Roughness'].default_value=.3
label=bpy.data.materials.new('Text');label.diffuse_color=(.9,.92,.95,1)
def text(body,loc,size=.12):
 cu=bpy.data.curves.new(body,'FONT');cu.body=body;cu.align_x='CENTER';cu.size=size;o=bpy.data.objects.new(body,cu);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(label);return o
objects=[]
for col,g in enumerate(data['geometries']):
 p=g['position'];verts=[(p[i],p[i+1]+.25,p[i+2]) for i in range(0,len(p),3)];idx=g['index'];faces=[idx[i:i+3] for i in range(0,len(idx),3)]
 mesh=bpy.data.meshes.new(g['detail']);mesh.from_pydata(verts,[],faces);mesh.update()
 for face in mesh.polygons:face.use_smooth=True
 n=g['normal'];mesh.normals_split_custom_set_from_vertices([n[i:i+3] for i in range(0,len(n),3)])
 o=bpy.data.objects.new(g['detail'],mesh);s.collection.objects.link(o);o.data.materials.append(mat);o.location=(col*1.05-1.05,0,0);o.scale=(.8,.8,1);objects.append(o)
 text(g['detail'].upper(),(col*1.05-1.05,-.10,-.70),.13);text(str(g['triangles'])+' triangles',(col*1.05-1.05,-.10,-.89),.10)
text('CASING GEOMETRY REVIEW  |  same brass approximation',(0,0,1.12),.11)
text('Magnified: shape comparison only, not native game pixels',(0,0,-1.15),.085)
for loc,power,size in [((1,-3,4),700,3),((-3,-1,1),400,2),((0,3,3),900,2)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-5,2.5));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=4.1;s.camera=cam
s.render.filepath=str(out/'casing-macro.png');bpy.ops.wm.save_as_mainfile(filepath=str(out/'casing-review.blend'));bpy.ops.render.render(write_still=True)
# Screen-space views use a side-on orthographic projection equal to the local
# scale of a 90-degree vertical perspective camera at the stated depth.
for o in list(s.objects):
 if o.type=='FONT':bpy.data.objects.remove(o,do_unlink=True)
cam.location=(0,-5,0);cam.rotation_euler=(math.pi/2,0,0);s.render.resolution_x=1920;s.render.resolution_y=1080
for d in [.5,1,3]:
 vertical=2*d;cam.data.ortho_scale=vertical*1920/1080
 for j,o in enumerate(objects):o.scale=(.0192,.0192,.042);o.location=((j-1)*vertical*.40,0,0)
 labels=[]
 for j,g in enumerate(data['geometries']):labels.append(text(g['detail']+' / '+str(g['triangles'])+' tri',((j-1)*vertical*.40,-.1,-vertical*.12),vertical*.025))
 labels.append(text(f'{d:g} m equivalent | 1080p / 90 deg vertical | side-on 42 mm casing',(0,-.1,vertical*.25),vertical*.024))
 labels.append(text('Blender approximation; inspect PNG at 100%, not enlarged',(0,-.1,-vertical*.30),vertical*.020))
 s.render.filepath=str(out/f'casing-distance-{d:g}m.png');bpy.ops.render.render(write_still=True)
 for o in labels:bpy.data.objects.remove(o,do_unlink=True)
