extends Node3D
class_name GHOriginalPropLibrary
const Importer = preload("res://capture_importer.gd")
var packet: Dictionary={}
var binary: PackedByteArray
var importer: GHSourceCaptureImporter
var prop_roots: Dictionary={}
var child_nodes: Dictionary={}
var child_items: Dictionary={}
var source_hello: Dictionary={}
var metadata_path: String=""
var metadata_sha256: String=""
var bound: bool=false
var loaded: bool=false
var statistics: Dictionary={"mappedInitialProps":0,"mappedChildren":0,"appliedBodies":0,"missingBodiesHidden":0,
	"unmappedDynamicBodyRecords":0,"unmappedInitialBodyRecords":0,"snapshots":0,"unsupportedChildren":[]}
var capture_materials: Dictionary={"mappedChildren":0,"mappedSurfaces":0,"unmappedChildren":[],"proof":"Exact owner/geometry match plus surface slot/mode/start/count/indices; capture material objects reused, no UUID inference"}

func load_assets(path: String,material_factory: Callable=Callable()) -> void:
	assert(packet.is_empty())
	metadata_path=path
	var json_bytes: PackedByteArray=FileAccess.get_file_as_bytes(path)
	metadata_sha256=_hash(json_bytes)
	var value: Variant=JSON.parse_string(json_bytes.get_string_from_utf8())
	assert(value is Dictionary and value.get("schema","")=="gh-original-prop-rest-v1")
	packet=value
	binary=FileAccess.get_file_as_bytes(path.get_base_dir().path_join(str(packet.binary.uri)))
	assert(binary.size()==int(packet.binary.bytes) and _hash(binary)==str(packet.binary.sha256))
	var snapshot: Dictionary={"source":{"coreSHA256":packet.source.coreSHA256},"materials":{},"geometries":{}}
	for material in packet.materials:
		var record: Dictionary=material.duplicate(true)
		record.id="prop_material_%d"%int(material.id)
		if not record.color is Array: record.color=[1,1,1]
		snapshot.materials[record.id]=record
	for geometry in packet.geometries:
		var id: String="prop_geometry_%d"%int(geometry.id)
		var converted: Dictionary={}
		for name in geometry.attributes:
			var attribute: Dictionary=geometry.attributes[name]
			converted[name]={"itemSize":attribute.itemSize,"count":attribute.count,"normalized":false,"values":_values(attribute)}
		snapshot.geometries[id]={"id":id,"type":geometry.type,"position":converted.get("position"),"normal":converted.get("normal"),
			"uv":converted.get("uv"),"color":converted.get("color"),"index":_values(geometry.index) if geometry.index is Dictionary else null,
			"nativeInstanceCount":geometry.nativeInstanceCount,"extraAttributes":geometry.allOriginalAttributeNames}
	importer=Importer.new()
	add_child(importer)
	if not importer.prepare(snapshot,material_factory): return
	# Original geometry bytes are loaded without copying source body world/home into vertices.
	# Render nodes stay hidden until HELLO identity is verified and a live body arrives.
	for prop in packet.props:
		var root: Node3D=Node3D.new()
		root.name="original_prop_%d_%s"%[int(prop.sourcePropIndex),str(prop.name)]
		root.visible=false
		add_child(root)
		prop_roots[int(prop.sourcePropIndex)]=root
		for child in prop.children:
			var geometry: Dictionary=packet.geometries[int(child.geometry)]
			if not geometry.morphAttributes.is_empty():
				statistics.unsupportedChildren.append({"prop":prop.sourcePropIndex,"path":child.path,"reason":"original morph target semantics unported"})
				continue
			var item: Dictionary=_item(prop,child,geometry)
			importer._import_object(item)
			if importer.objects.has(item.id):
				var node: Node3D=importer.objects[item.id]
				child_nodes[item.id]=node
				child_items[item.id]=item
				node.reparent(root,false)
				node.visible=bool(child.effectiveVisibleWithinRoot)
				statistics.mappedChildren+=1
	statistics.mappedInitialProps=prop_roots.size()
	loaded=true

func bind_capture_child(item: Dictionary,decision: Dictionary,capture_importer: GHSourceCaptureImporter) -> void:
	assert(decision.kind=="replaced-prop-rest-mapped")
	var id: String="prop/%d%s"%[int(decision.sourcePropIndex),str(decision.childPath)]
	if not child_nodes.has(id):
		capture_materials.unmappedChildren.append({"id":id,"reason":"original rest child not renderable"})
		return
	var original: Dictionary=child_items[id]
	var same: bool=original.surfaces.size()==item.surfaces.size()
	if same:
		for i in range(original.surfaces.size()):
			var a: Dictionary=original.surfaces[i]
			var b: Dictionary=item.surfaces[i]
			for key in ["slot","mode","start","count"]:
				if a[key]!=b[key]: same=false
			if PackedInt32Array(a.indices)!=PackedInt32Array(b.indices): same=false
	if not same:
		capture_materials.unmappedChildren.append({"id":id,"sourceID":item.id,"reason":"capture surface topology/slots differ; scalar fallback retained"})
		return
	var node: GeometryInstance3D=child_nodes[id]
	if node is MeshInstance3D:
		for i in range(item.surfaces.size()): node.set_surface_override_material(i,capture_importer.materials[item.surfaces[i].material])
	elif node is MultiMeshInstance3D and item.surfaces.size()==1:
		node.material_override=capture_importer.materials[item.surfaces[0].material]
	else:
		capture_materials.unmappedChildren.append({"id":id,"reason":"multi-surface instancing material binding unported"})
		return
	capture_materials.mappedChildren+=1
	capture_materials.mappedSurfaces+=item.surfaces.size()
	node.set_meta("capture_material_source",{"sourceID":item.id,"materials":item.materials,"owner":decision.owner})

func finish_capture_binding() -> void:
	for id in child_nodes:
		if not child_nodes[id].has_meta("capture_material_source") and not capture_materials.unmappedChildren.any(func(item: Dictionary) -> bool: return str(item.id)==str(id)):
			capture_materials.unmappedChildren.append({"id":id,"reason":"no exact source capture child/material evidence; original scalar proxy retained"})

func bind_source(hello: Dictionary) -> void:
	assert(not bound and not packet.is_empty())
	assert(str(hello.coreSHA256)==str(packet.source.coreSHA256))
	assert(str(hello.initializerSHA256)==str(packet.source.initializerSHA256),"Immutable initializer differs")
	assert(hello.initialBodies.size()==packet.props.size())
	if hello.get("propAssets") is Dictionary:
		assert(str(hello.propAssets.jsonSHA256)==metadata_sha256)
		assert(str(hello.propAssets.binarySHA256)==str(packet.binary.sha256))
	for prop in packet.props:
		var i: int=int(prop.sourcePropIndex)
		var source: Dictionary=hello.initialBodies[i]
		assert(int(source.sourcePropIndex)==i and str(source.name)==str(prop.name))
		assert(source.homeP==prop.homeP and source.homeQ==prop.homeQ,"Initial original homes differ")
		assert(str(hello.bodyModels[int(source.model)])==str(prop.name))
	source_hello=hello
	bound=true

func apply_bodies(bodies: Array) -> void:
	assert(bound)
	statistics.snapshots+=1
	var seen: Dictionary={}
	for body in bodies:
		var index: int=int(body.sourcePropIndex)
		if not prop_roots.has(index):
			statistics.unmappedDynamicBodyRecords+=1
			continue # gun/mag/ceiling tile/nade require true separate assets.
		var initial: Dictionary=source_hello.initialBodies[index]
		if int(body.id)!=int(initial.id) or int(body.model)!=int(initial.model) or (int(body.flags)&4)!=0:
			statistics.unmappedInitialBodyRecords+=1
			continue
		var root: Node3D=prop_roots[index]
		root.global_transform=_matrix(body.matrix)
		root.visible=(int(body.flags)&1)!=0
		seen[index]=true
		statistics.appliedBodies+=1
	for index in prop_roots:
		if not seen.has(index):
			prop_roots[index].visible=false
			statistics.missingBodiesHidden+=1

func root_state_report() -> Array:
	var rows: Array=[]
	for index in prop_roots:
		var node: Node3D=prop_roots[index]
		var transform_value: Transform3D=node.global_transform
		rows.append({"sourcePropIndex":index,"visible":node.visible,
			"origin":[transform_value.origin.x,transform_value.origin.y,transform_value.origin.z],
			"basisColumns":[transform_value.basis.x.x,transform_value.basis.x.y,transform_value.basis.x.z,
				transform_value.basis.y.x,transform_value.basis.y.y,transform_value.basis.y.z,
				transform_value.basis.z.x,transform_value.basis.z.y,transform_value.basis.z.z]})
	return rows

func _item(prop: Dictionary,child: Dictionary,g: Dictionary) -> Dictionary:
	var indices: Array=_values(g.index) if g.index is Dictionary else []
	var total: int=indices.size() if g.index is Dictionary else int(g.attributes.position.count)
	if not g.index is Dictionary:
		for i in range(total): indices.append(i)
	var ranges: Array=g.groups if child.materialArray else [{"start":0,"count":total,"materialIndex":0}]
	var draw_start: int=int(g.drawRange.start)
	var draw_end: int=total if g.drawRange.count==null else draw_start+int(g.drawRange.count)
	var surfaces: Array=[]
	for range_item in ranges:
		var from: int=maxi(draw_start,int(range_item.start))
		var range_end: int=total if range_item.count==null else int(range_item.start)+int(range_item.count)
		var to: int=mini(total,mini(draw_end,range_end))
		var slot: int=int(range_item.materialIndex)
		if to<=from or not bool(packet.materials[int(child.materials[slot])].visible): continue
		var selected: Array=indices.slice(from,to)
		if child.primitive=="line_loop" and selected.size()>1: selected.append(selected[0])
		surfaces.append({"material":"prop_material_%d"%int(child.materials[slot]),"slot":slot,
			"mode":"line_strip" if child.primitive=="line_loop" else child.primitive,"start":from,"count":selected.size(),"indices":selected})
	var material_ids: Array=[]
	for id in child.materials: material_ids.append("prop_material_%d"%int(id))
	var instances: Variant=null
	if child.instances is Dictionary:
		instances={"count":child.instances.count,"matrices":_values(child.instances.matrix),"colors":null}
		if child.instances.colors is Dictionary:
			instances.colors={"itemSize":child.instances.colors.itemSize,"values":_values(child.instances.colors)}
	return {"id":"prop/%d%s"%[int(prop.sourcePropIndex),str(child.path)],"nativeID":prop.sourcePropIndex,"name":child.name,
		"path":"original-prop/%d%s"%[int(prop.sourcePropIndex),str(child.path)],"owners":[{"kind":"physics","propIndex":prop.sourcePropIndex,"path":child.path}],
		"geometry":"prop_geometry_%d"%int(g.id),"materials":material_ids,"surfaces":surfaces,
		"topologyKey":"prop_geometry_%d|%s"%[int(g.id),JSON.stringify(surfaces)],"matrix":child.relativeMatrix,
		"visible":false,"layers":child.layers,"castShadow":child.castShadow,"frustumCulled":child.frustumCulled,
		"receiveShadow":child.receiveShadow,"renderOrder":child.renderOrder,"instances":instances}

func _values(record: Dictionary) -> Array:
	var offset: int=int(record.byteOffset)
	var size: int=int(record.byteLength)
	assert(offset>=0 and size>0 and offset+size<=binary.size())
	assert(_hash(binary.slice(offset,offset+size))==str(record.sha256))
	var result: Array=[]
	for i in range(int(record.length)):
		var value: float=0.0
		match str(record.type):
			"Float32Array": value=binary.decode_float(offset+i*4)
			"Float64Array": value=binary.decode_double(offset+i*8)
			"Uint8Array": value=binary[offset+i]
			"Uint16Array": value=binary.decode_u16(offset+i*2)
			"Uint32Array": value=binary.decode_u32(offset+i*4)
			"Int8Array": value=binary.decode_s8(offset+i)
			"Int16Array": value=binary.decode_s16(offset+i*2)
			"Int32Array": value=binary.decode_s32(offset+i*4)
			_: assert(false,"Unsupported original typed attribute")
		if bool(record.get("normalized",false)):
			match str(record.type):
				"Uint8Array": value/=255.0
				"Uint16Array": value/=65535.0
				"Uint32Array": value/=4294967295.0
				"Int8Array": value=maxf(value/127.0,-1.0)
				"Int16Array": value=maxf(value/32767.0,-1.0)
				"Int32Array": value=maxf(value/2147483647.0,-1.0)
		result.append(value)
	return result

func _matrix(m: Variant) -> Transform3D:
	return Transform3D(Basis(Vector3(m[0],m[1],m[2]),Vector3(m[4],m[5],m[6]),Vector3(m[8],m[9],m[10])),Vector3(m[12],m[13],m[14]))

func _hash(bytes: PackedByteArray) -> String:
	var context: HashingContext=HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()
