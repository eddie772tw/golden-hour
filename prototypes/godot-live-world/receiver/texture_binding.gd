extends RefCounted
# Standard-material subset only. Exact base payload transfer is separate from
# renderer sampling/shading parity; reject unrepresentable bindings explicitly.
var manifest: Dictionary = {}
var snapshot: Dictionary = {}
var directory: String = ""
var cache: Dictionary = {}
var report: Dictionary = {"bound":[],"unsupported":[],"warnings":[],"loaded_assets":0,"source_colors":"Three linear factors -> Godot sRGB Color factors; original texture bytes unchanged"}

func load_manifest(path: String, scene: Dictionary) -> bool:
	var file: FileAccess = FileAccess.open(path,FileAccess.READ)
	if file == null: return false
	var data: Variant = JSON.parse_string(file.get_as_text())
	if not data is Dictionary or data.get("schema","") != "gh-godot-pbr-textures-v1": return false
	if data.source.coreSHA256 != scene.source.coreSHA256 or data.source.geometryCapturedAt != scene.source.capturedAt: return false
	var a: Array = data.source.materialIDs.duplicate()
	var b: Array = scene.materials.keys()
	a.sort()
	b.sort()
	if a != b: return false
	manifest = data
	snapshot = scene
	directory = path.get_base_dir()
	return true

func _reject(material: String, slot: String, reason: String) -> void:
	report.unsupported.append({"material":material,"slot":slot,"reason":reason})

func _geometry_attribute(material: String, attribute: String) -> bool:
	for object in snapshot.objects:
		if material in object.materials:
			var geometry: Dictionary = snapshot.geometries[object.geometry]
			if not geometry.get(attribute) is Dictionary: return false
			if attribute=="tangent" and bool(geometry.get("frozenPose",false)): return false
	return true

func _texture(id: String) -> Texture2D:
	if cache.has(id): return cache[id]
	var item: Dictionary = manifest.textures[id]
	if not str(item.file).begins_with("textures/") or ".." in str(item.file): return null
	var bytes: PackedByteArray = FileAccess.get_file_as_bytes(directory.path_join(str(item.file)))
	if bytes.size() != int(item.byteLength): return null
	var hashing: HashingContext = HashingContext.new()
	hashing.start(HashingContext.HASH_SHA256)
	hashing.update(bytes)
	if hashing.finish().hex_encode() != str(item.sha256): return null
	var image: Image
	if item.encoding == "rgba8":
		if bytes.size() != int(item.width)*int(item.height)*4: return null
		image = Image.create_from_data(int(item.width),int(item.height),false,Image.FORMAT_RGBA8,bytes)
	elif item.encoding == "png":
		image = Image.new()
		if image.load_png_from_buffer(bytes) != OK: return null
	else: return null
	if image.get_width()!=int(item.width) or image.get_height()!=int(item.height): return null
	# Preserve source UV coordinates. Native Three upload flip is applied once to rows.
	if bool(item.flipY): image.flip_y()
	if bool(item.generateMipmaps):
		image.generate_mipmaps()
		report.warnings.append({"texture":id,"reason":"Godot regenerated mipmaps; base payload exact, mip kernels/precision not proved identical"})
	var texture: ImageTexture = ImageTexture.create_from_image(image)
	cache[id] = texture
	report.loaded_assets += 1
	return texture

func apply(material_id: String, target: StandardMaterial3D) -> void:
	if manifest.is_empty() or not manifest.materials.has(material_id): return
	var source: Dictionary = manifest.materials[material_id]
	var sampler_key: String = ""
	var uv_keys: Dictionary = {}
	for slot in ["map","normalMap","roughnessMap","metalnessMap","emissiveMap","aoMap","alphaMap"]:
		if not source.maps.has(slot): continue
		var binding: Dictionary = source.maps[slot]
		var item: Dictionary = manifest.textures[binding.texture]
		var reason: String = ""
		if item.status != "captured": reason = str(item.get("reason","Texture not captured"))
		elif slot == "alphaMap": reason = "Independent green alphaMap product cannot be represented exactly by StandardMaterial3D; no prebake approximation"
		elif bool(item.premultiplyAlpha): reason = "Premultiplied upload/blending not mapped"
		elif int(item.manualMipmaps)>0: reason = "Original manual mip chain not transferred"
		elif str(item.colorSpace) != ("srgb" if binding.color=="srgb" else ""): reason = "Texture colorSpace is not the canonical sRGB-color / no-color-space-data subset"
		elif int(item.wrapS)!=int(item.wrapT) or not int(item.wrapS) in [1000,1001]: reason = "Independent axis or mirrored wrap not expressible by material repeat flag"
		elif float(item.anisotropy)!=1.0: reason = "Per-texture anisotropy not equivalent to Godot global/material sampler"
		var filter_mode: int = -1
		if int(item.minFilter)==1006 and int(item.magFilter)==1006: filter_mode=BaseMaterial3D.TEXTURE_FILTER_LINEAR
		elif int(item.minFilter)==1003 and int(item.magFilter)==1003: filter_mode=BaseMaterial3D.TEXTURE_FILTER_NEAREST
		elif int(item.minFilter)==1008 and int(item.magFilter)==1006 and bool(item.generateMipmaps): filter_mode=BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		if reason.is_empty() and filter_mode<0: reason="Sampler min/mag/mip mode outside validated subset"
		var channel: int = int(item.channel)
		if reason.is_empty() and channel!=0 and not (channel==1 and slot in ["aoMap","emissiveMap"]): reason="Map UV channel not expressible by this StandardMaterial slot"
		if reason.is_empty() and channel==1 and not _geometry_attribute(material_id,"uv1"): reason="Original secondary UV missing on at least one owning geometry"
		var matrix: Array = item.matrix
		if reason.is_empty() and (absf(float(matrix[1]))>0.000001 or absf(float(matrix[3]))>0.000001 or absf(float(matrix[2]))>0.000001 or absf(float(matrix[5]))>0.000001 or absf(float(matrix[8])-1.0)>0.000001): reason="UV rotation/shear/projective transform not mapped; no silent bake"
		if reason.is_empty() and slot=="normalMap":
			if int(source.normalMapType)!=0 or source.normalScale != [1,1]: reason="Non-default or object-space normal mapping needs a verified normal-basis adaptor"
			elif not _geometry_attribute(material_id,"tangent"): reason="No original tangent frame in geometry; derivative-vs-generated basis parity not assumed"
		if reason.is_empty() and slot=="aoMap" and float(source.aoMapIntensity)!=1.0: reason="Three AO intensity is not Godot ao_light_affect; no channel rebake"
		var current_sampler: String = str(item.wrapS)+"/"+str(filter_mode)
		var transform_key: String = JSON.stringify([matrix[0],matrix[4],matrix[6],matrix[7]])
		if reason.is_empty() and not sampler_key.is_empty() and sampler_key!=current_sampler: reason="Map sampler differs from other bound maps; StandardMaterial has one sampler policy"
		if reason.is_empty() and uv_keys.has(channel) and uv_keys[channel]!=transform_key: reason="Per-map UV transform differs from another bound map on the same UV set"
		if not reason.is_empty():
			_reject(material_id,slot,reason)
			continue
		var texture: Texture2D = _texture(binding.texture)
		if texture == null:
			_reject(material_id,slot,"Payload load/hash/format/size validation failed")
			continue
		sampler_key=current_sampler
		uv_keys[channel]=transform_key
		target.texture_filter=filter_mode
		target.texture_repeat=int(item.wrapS)==1000
		if channel==0:
			target.uv1_scale=Vector3(matrix[0],matrix[4],1)
			target.uv1_offset=Vector3(matrix[6],matrix[7],0)
		else:
			target.uv2_scale=Vector3(matrix[0],matrix[4],1)
			target.uv2_offset=Vector3(matrix[6],matrix[7],0)
		match slot:
			"map": target.albedo_texture=texture
			"normalMap":
				target.normal_enabled=true
				target.normal_texture=texture
				target.normal_scale=1.0
			"roughnessMap":
				target.roughness_texture=texture
				target.roughness_texture_channel=BaseMaterial3D.TEXTURE_CHANNEL_GREEN
			"metalnessMap":
				target.metallic_texture=texture
				target.metallic_texture_channel=BaseMaterial3D.TEXTURE_CHANNEL_BLUE
			"emissiveMap":
				target.emission_enabled=true
				target.emission_texture=texture
				target.emission_operator=BaseMaterial3D.EMISSION_OP_MULTIPLY
				target.emission_on_uv2=channel==1
			"aoMap":
				target.ao_enabled=true
				target.ao_texture=texture
				target.ao_texture_channel=BaseMaterial3D.TEXTURE_CHANNEL_RED
				target.ao_on_uv2=channel==1
		report.bound.append({"material":material_id,"slot":slot,"texture":binding.texture,"channel":binding.channel,"uv":channel,"flipRows":item.flipY,"base_sha256":item.sha256})
