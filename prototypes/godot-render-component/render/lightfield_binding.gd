extends RefCounted
# Exact external RGBAH bytes; fixed source accumulator. No implicit time update.
const FIXTURE_SHA: String="6059bd1d092ac0a9ccfa0117021513b2b0cc32da5631e0c48031f16237776558"
const CORE_SHA: String="b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b"
var fixture: Dictionary={}
var raw_bytes: PackedByteArray
var images: Array[Image]=[]
var texture: ImageTexture3D
var shader_source: String=""
var matched: Dictionary={}
var report: Dictionary={"enabled":false,"matched":[],"unmatched":[],"errors":[],"image_format":"RGBAH","source_color_hint":false,"sample_filter":"linear/clamp/no-mips","time_source":"Fixed original HM lighting accumulator; not G.time/tick/60, Node simSeconds or Godot TIME","fullMaterialParity":false}

func _sha(bytes: PackedByteArray) -> String:
	var hash: HashingContext=HashingContext.new()
	hash.start(HashingContext.HASH_SHA256)
	hash.update(bytes)
	return hash.finish().hex_encode()

func _reject(reason: String) -> bool:
	report.errors.append(reason)
	push_warning("GH_HM_REJECT "+reason)
	return false

func load_source(fixture_path: String,volume_path: String,upload: bool=true) -> bool:
	report.enabled=true
	var bytes: PackedByteArray=FileAccess.get_file_as_bytes(fixture_path)
	if bytes.size()>1024*1024 or _sha(bytes)!=FIXTURE_SHA: return _reject("Bounded fixture byte hash mismatch")
	var data: Variant=JSON.parse_string(bytes.get_string_from_utf8())
	if not data is Dictionary or data.get("schema","")!="gh-hm-typed-fixture-v1": return _reject("HM fixture schema mismatch")
	fixture=data
	if fixture.source.coreSHA256!=CORE_SHA or fixture.source.quality!="high" or int(fixture.source.tick)!=240: return _reject("Reviewed source/core/High/tick required")
	var t: Dictionary=fixture.texture
	if int(t.type)!=1016 or int(t.format)!=1023 or int(t.width)!=60 or int(t.height)!=18 or int(t.depth)!=46 or t.colorSpace!="" or not bool(t.flags.data3D) or bool(t.flags.renderTarget): return _reject("Real HM half-float3D descriptor required, never noise")
	if fixture.asset.arrayType!="Uint16Array" or fixture.asset.byteOrder!="little-endian" or int(fixture.asset.byteLength)!=397440: return _reject("Original little-endian half words required")
	if volume_path.is_empty(): return _reject("Explicit external original HM binary required")
	raw_bytes=FileAccess.get_file_as_bytes(volume_path)
	if raw_bytes.size()!=397440 or _sha(raw_bytes)!=fixture.asset.sha256: return _reject("Original HM typed bytes length/SHA mismatch")
	shader_source=FileAccess.get_file_as_string("res://lightfield.gdshaderinc")
	if _sha(shader_source.to_utf8_buffer())!=fixture.nativeShaderSHA256: return _reject("Native TY source hash mismatch")
	images.clear()
	var reconstructed: PackedByteArray=PackedByteArray()
	var stride: int=60*18*4*2
	for z in range(46):
		var slice: PackedByteArray=raw_bytes.slice(z*stride,(z+1)*stride)
		var image: Image=Image.create_from_data(60,18,false,Image.FORMAT_RGBAH,slice)
		if image==null or image.get_format()!=Image.FORMAT_RGBAH or image.get_data()!=slice: return _reject("Native Image RGBAH changed source half words")
		images.append(image)
		reconstructed.append_array(image.get_data())
	if reconstructed!=raw_bytes: return _reject("3D z-slice ordering changed original bytes")
	if upload:
		texture=ImageTexture3D.new()
		var error: Error=texture.create(Image.FORMAT_RGBAH,60,18,46,false,images)
		if error!=OK: return _reject("ImageTexture3D RGBAH create failed: "+str(error))
	report["fixture_sha256"]=FIXTURE_SHA
	report["source_manifest_sha256"]=fixture.sourceManifestSHA256
	report["source_ty_sha256"]=fixture.sourceTYSHA256
	report["native_ty_sha256"]=fixture.nativeShaderSHA256
	report["asset_sha256"]=fixture.asset.sha256
	report["asset_bytes"]=raw_bytes.size()
	report["slice_count"]=images.size()
	report["cpu_image_bytes_exact"]=true
	report["texture_uploaded"]=upload
	report["fixed_source_time"]=fixture.uniforms.ghLVT.vector[0]
	report["clock_note"]="Source ZD closure accumulates hotel.update(delta) through menu/loading as well as playing; benchmark resets G.time but not this closure. No live clock mapping implemented."
	return true

func _matrix(values: Array) -> Transform3D:
	return Transform3D(Basis(Vector3(values[0],values[1],values[2]),Vector3(values[4],values[5],values[6]),Vector3(values[8],values[9],values[10])),Vector3(values[12],values[13],values[14]))

func bind(material: ShaderMaterial,base_only: bool=false) -> void:
	material.set_shader_parameter("ghLV",texture)
	for key in ["ghLVMat","ghLVOrg","ghLVInv","ghLVK","ghLVT","ghPool","ghChand"]:
		var u: Dictionary=fixture.uniforms[key]
		if u.has("matrix"): material.set_shader_parameter(key,_matrix(u.matrix))
		elif u.vector.size()==3: material.set_shader_parameter(key,Vector3(u.vector[0],u.vector[1],u.vector[2]))
		else:
			var v: Vector4=Vector4(u.vector[0],u.vector[1],u.vector[2],u.vector[3])
			if key=="ghLVK" and base_only: v.z=0;v.w=0
			material.set_shader_parameter(key,v)

func _same_numbers(a: Variant,b: Variant) -> bool:
	if not a is Array or not b is Array or a.size()!=b.size(): return false
	for i in range(a.size()):
		if float(a[i])!=float(b[i]): return false
	return true

func _same_material(source: Dictionary,role: Dictionary) -> bool:
	if source.type!=role.type: return false
	for key in ["side","transparent","opacity","depthWrite","depthTest","colorWrite","stencilWrite","blending","vertexColors"]:
		if source.get(key,false)!=role.scalarFlags.get(key,false):
			# Godot Variant Array equality distinguishes ints/floats; compare scalar
			# numeric flags exactly without relaxing the source values.
			if typeof(source.get(key)) in [TYPE_INT,TYPE_FLOAT] and typeof(role.scalarFlags.get(key)) in [TYPE_INT,TYPE_FLOAT]:
				if float(source[key])==float(role.scalarFlags[key]): continue
			return false
	if not _same_numbers(source.color,role.sourceFactors.color.color): return false
	if float(source.metalness)!=float(role.sourceFactors.metalness): return false
	return true

func match_snapshot(snapshot: Dictionary) -> bool:
	if snapshot.source.get("coreSHA256","")!=CORE_SHA or snapshot.source.get("quality","")!="high": return _reject("Receiver snapshot source/core/High mismatch")
	var by_path: Dictionary={}
	for role in fixture.roles:
		for owner in role.owners:
			var key: String=str(owner.path)+"|"+str(int(owner.nativeID))+"|"+str(int(owner.slot))
			if not by_path.has(key): by_path[key]=[]
			by_path[key].append({"role":role,"owner":owner})
	var relations: Dictionary={}
	var bad: Dictionary={}
	for object in snapshot.objects:
		var geometry: Dictionary=snapshot.geometries[object.geometry]
		for slot in range(object.materials.size()):
			var id: String=str(object.materials[slot])
			var source: Dictionary=snapshot.materials[id]
			if not source.type in ["MeshStandardMaterial","MeshPhysicalMaterial"]: continue
			var key: String=str(object.path)+"|"+str(int(object.nativeID))+"|"+str(slot)
			var hits: Array=[]
			for candidate in by_path.get(key,[]):
				var owner: Dictionary=candidate.owner
				var role: Dictionary=candidate.role
				var index_count: int=geometry.index.size() if geometry.index is Array else -1
				var original_index: int=int(owner.indexCount) if owner.indexCount!=null else -1
				if owner.type==object.type and owner.name==object.name and owner.geometryType==geometry.type and int(owner.vertices)==int(geometry.position.count) and original_index==index_count and int(owner.layers)==int(object.layers) and int(owner.renderOrder)==int(object.renderOrder) and _same_material(source,role): hits.append(candidate)
			if hits.size()!=1:
				bad[id]="Owner/path/nativeID/slot/geometry/flags/factors relation absent or ambiguous (UUID never used)"
				continue
			var role: Dictionary=hits[0].role
			if relations.has(id) and relations[id].sourceMaterial!=role.sourceMaterial: bad[id]="Different source compiled roles share this receiver material"
			else: relations[id]=role
	for id in snapshot.materials:
		var source: Dictionary=snapshot.materials[id]
		if not source.type in ["MeshStandardMaterial","MeshPhysicalMaterial"]: continue
		if not relations.has(id) or bad.has(id):
			report.unmatched.append({"material":id,"reason":bad.get(id,"No source compiled role relation")})
			continue
		var role: Dictionary=relations[id]
		matched[id]=role
		report.matched.append({"receiver_material":id,"source_role_provenance":role.sourceMaterial,"role_nativeID":role.nativeID,"role_name":role.name,"has_unported_Nj":role.hasNjSurface,"compiledVariants":role.compiledVariants,"relation":"source/core/unique owner path+nativeID+slot/object/geometry counts+type/raster flags/base color+metalness; UUID not matched"})
	report["matched_materials"]=matched.size()
	report["source_compiled_references"]=fixture.roles.size()
	report["limitations"]=["Adds only source HM irradiance→diffuse/PI to EMISSION, never replaces environment IRRADIANCE","Current ALBEDO/normal differ where original surface hooks/layout/skin are unported","Full Nj ghAO/joints/wear and direct specular AO are not restored; HM receiver AO uses only already-supported aoMap when present","177 captured ghLV references do not mean177 fully matched receiver materials or material/High parity"]
	return matched.size()>0 or _reject("No guarded receiver roles matched")
