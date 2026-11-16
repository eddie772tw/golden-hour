extends Node3D
class_name GHBridgeNativeSkin
# Isolated affine-palette consumer. No engine execution claimed by the exporter.
# Skeleton3D/Skin are retained as rest metadata; they DO NOT drive this RS instance.
var packet: Dictionary
var asset: Dictionary
var bytes: PackedByteArray
var array_mesh: ArrayMesh
var skeleton_metadata: Skeleton3D
var skin_metadata: Skin
var skeleton_rid: RID
var instance_rid: RID
var pose_index: int = 0
var source_root_world: Transform3D = Transform3D.IDENTITY
var last_live_palette: PackedFloat32Array
var dummy: bool = false

func configure_shared(template: GHBridgeNativeSkin) -> void:
	assert(not is_inside_tree())
	packet = template.packet
	asset = template.asset
	bytes = template.bytes
	array_mesh = template.array_mesh
	skin_metadata = template.skin_metadata
	set_meta("high_parity",false)
	set_meta("source_core",packet.source.coreSHA256)

func configure(path: String, team: int = 0) -> void:
	assert(not is_inside_tree(), "Configure before adding to a tree")
	var value: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	assert(value is Dictionary and value.get("schema", "") == "gh-native-live-skin-v1")
	packet = value
	bytes = FileAccess.get_file_as_bytes(path.get_base_dir().path_join(str(packet.binary.uri)))
	assert(bytes.size() == int(packet.binary.bytes) and _hash(bytes) == str(packet.binary.sha256))
	assert(team >= 0 and team < packet.assets.size())
	asset = packet.assets[team]
	assert(str(asset.bindMode) == "attached")
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = _vec3(asset.attributes.position)
	arrays[Mesh.ARRAY_NORMAL] = _vec3(asset.attributes.normal)
	var uv: Array = _values(asset.attributes.uv)
	var uvs: PackedVector2Array = PackedVector2Array()
	for i in range(0, uv.size(), 2): uvs.append(Vector2(uv[i], uv[i+1]))
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	if asset.attributes.has("color"):
		var c: Array = _values(asset.attributes.color)
		var colors: PackedColorArray = PackedColorArray()
		for i in range(0, c.size(), 3): colors.append(Color(c[i], c[i+1], c[i+2], 1.0))
		arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_BONES] = PackedInt32Array(_values(asset.attributes.skinIndex))
	arrays[Mesh.ARRAY_WEIGHTS] = PackedFloat32Array(_values(asset.attributes.skinWeight))
	# Already converted once by exporter. Do not reverse these indices again.
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array(_values(asset.godotClockwiseIndex))
	array_mesh = ArrayMesh.new()
	array_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var material: StandardMaterial3D = StandardMaterial3D.new()
	material.vertex_color_use_as_albedo = true
	material.resource_name = "DIAGNOSTIC only; native High shader and textures unported"
	array_mesh.surface_set_material(0, material)
	# Preserve exact original hierarchy/rest/inverse binds as inspectable resources.
	skeleton_metadata = Skeleton3D.new()
	skeleton_metadata.name = "OriginalRestMetadata_NotAnimationDriver"
	skin_metadata = Skin.new()
	for bone in asset.bones: skeleton_metadata.add_bone(str(bone.name))
	for bone in asset.bones:
		var i: int = int(bone.index)
		skeleton_metadata.set_bone_parent(i, int(bone.parent))
		skeleton_metadata.set_bone_rest(i, _matrix(bone.restLocal))
		skin_metadata.add_bind(i, _matrix(bone.inverseBind))
	add_child(skeleton_metadata)
	# aux/aux2 remain in bytes/asset descriptors. They are NOT silently treated as ported shaders.
	set_meta("unported_source_attributes", asset.preservedButNotMappedToGodotHigh)
	set_meta("high_parity", false)
	set_meta("source_core", packet.source.coreSHA256)

func _ready() -> void:
	assert(array_mesh != null, "Call configure with a real native rest packet first")
	dummy=DisplayServer.get_name()=="headless"
	if dummy: return # Dummy tests parsing/application only; do not invent rendering RIDs.
	skeleton_rid = RenderingServer.skeleton_create()
	RenderingServer.skeleton_allocate_data(skeleton_rid, asset.bones.size(), false)
	instance_rid = RenderingServer.instance_create2(array_mesh.get_rid(), get_world_3d().scenario)
	RenderingServer.instance_attach_skeleton(instance_rid, skeleton_rid)
	RenderingServer.instance_set_ignore_culling(instance_rid, true) # Original body.frustumCulled=false.
	set_notify_transform(true)
	RenderingServer.instance_set_visible(instance_rid,false)

func apply_live_palette(root16: PackedFloat32Array, palettes: PackedFloat32Array, source_visible: bool) -> void:
	assert(root16.size() == 16 and palettes.size() == asset.bones.size()*16)
	source_root_world = _matrix(Array(root16))
	last_live_palette = palettes
	if dummy: return
	assert(skeleton_rid.is_valid())
	for i in range(asset.bones.size()):
		# GHLP contains the FINAL palette; inverse bind has ALREADY been multiplied.
		RenderingServer.skeleton_bone_set_transform(skeleton_rid,i,_matrix(Array(palettes.slice(i*16,i*16+16))))
	RenderingServer.instance_set_transform(instance_rid,global_transform*source_root_world)
	RenderingServer.instance_set_visible(instance_rid,source_visible)

func live_palette_readback_error() -> float:
	if last_live_palette.is_empty(): return -1.0
	var error: float = 0.0
	for i in range(asset.bones.size()):
		var expected: Transform3D = _matrix(Array(last_live_palette.slice(i*16,i*16+16)))
		var actual: Transform3D = RenderingServer.skeleton_bone_get_transform(skeleton_rid,i)
		for a in [actual.basis.x-expected.basis.x,actual.basis.y-expected.basis.y,actual.basis.z-expected.basis.z,actual.origin-expected.origin]:
			error=maxf(error,maxf(absf(a.x),maxf(absf(a.y),absf(a.z))))
	return error

func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSFORM_CHANGED and instance_rid.is_valid():
		RenderingServer.instance_set_transform(instance_rid, global_transform * source_root_world)

func _exit_tree() -> void:
	if instance_rid.is_valid(): RenderingServer.free_rid(instance_rid)
	if skeleton_rid.is_valid(): RenderingServer.free_rid(skeleton_rid)
	instance_rid = RID()
	skeleton_rid = RID()

func _values(record: Dictionary) -> Array:
	var from: int = int(record.byteOffset)
	var size: int = int(record.byteLength)
	assert(from >= 0 and size > 0 and from + size <= bytes.size())
	assert(_hash(bytes.slice(from, from + size)) == str(record.sha256))
	var result: Array = []
	for i in range(int(record.length)):
		match str(record.type):
			"Float32Array": result.append(bytes.decode_float(from + i * 4))
			"Uint16Array": result.append(bytes.decode_u16(from + i * 2))
			"Uint32Array": result.append(bytes.decode_u32(from + i * 4))
			"Uint8Array": result.append(bytes[from + i])
			_: assert(false, "Unsupported source scalar type")
	return result

func _vec3(record: Dictionary) -> PackedVector3Array:
	var values: Array = _values(record)
	var result: PackedVector3Array = PackedVector3Array()
	for i in range(0, values.size(), 3): result.append(Vector3(values[i], values[i+1], values[i+2]))
	return result

func _matrix(m: Array) -> Transform3D:
	assert(m.size() == 16)
	return Transform3D(Basis(Vector3(m[0],m[1],m[2]), Vector3(m[4],m[5],m[6]), Vector3(m[8],m[9],m[10])), Vector3(m[12],m[13],m[14]))

func _hash(data: PackedByteArray) -> String:
	var context: HashingContext = HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(data)
	return context.finish().hex_encode()
