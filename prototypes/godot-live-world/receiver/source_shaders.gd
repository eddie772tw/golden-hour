extends RefCounted
# Narrow, audited source-role port. UUID equality is never a matching condition.
# The optional frozen proof selects records from a separate browser session: only the static GL role
# and High quality branch are transferred, not its wall-clock/cosmetic uniforms.
const CORE: String = "b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b"
const AUDIT_SHA: String = "c5a9ecd23a8ccba9ff5d6532ffd599530a5f4781348764a1205ac2c934a0c36b"
const PROOF_SHA: String = "c2aa2a04e395a6f5590467ecc6db4976d8f478b27d3a7159e6dc6463b593c4d0"
const VERTEX_SHA: String = "ff9ea90420f2abffe746d1d0bcf24bfd8132f8587e174e96933df3d851af3274"
const FRAGMENT_SHA: String = "3c0210076da24ec761d424727d804c0b6c1e00fc317b924557a7fec0f9186b89"
const SHAFT = preload("res://shaft.gdshader")
var mapped: Dictionary = {}
var report: Dictionary = {"enabled":false,"ports":[],"unmatched":[],"unsupported":[],"highParity":false,"cross_session_uniforms_copied":false}

func _hash(bytes: PackedByteArray) -> String:
	var hash: HashingContext = HashingContext.new()
	hash.start(HashingContext.HASH_SHA256)
	hash.update(bytes)
	return hash.finish().hex_encode()

func _flags(m: Dictionary) -> bool:
	return m.type=="ShaderMaterial" and bool(m.shaderMaterial) and int(m.side)==2 and bool(m.transparent) and int(m.blending)==5 and bool(m.depthTest) and not bool(m.depthWrite) and bool(m.colorWrite) and not bool(m.get("stencilWrite",false))

func _owner(o: Dictionary) -> bool:
	if int(o.nativeID)!=1426 or o.path!="world/311:" or o.type!="Mesh" or int(o.layers)!=2 or int(o.renderOrder)!=15: return false
	if not o.matrix is Array or o.matrix.size()!=16: return false
	# JSON numbers parse as floats. Godot Array equality treats float1 != int1;
	# compare each numeric value exactly, with no epsilon or transform tolerance.
	for i in range(16):
		if not (o.matrix[i] is float or o.matrix[i] is int): return false
		if float(o.matrix[i])!=(1.0 if i%5==0 else 0.0): return false
	return true

func _reject(reason: String, detail: Variant = null) -> bool:
	report.unmatched.append({"reason":reason,"detail":detail})
	push_warning("GH_SOURCE_SHADER_UNMATCHED " + JSON.stringify(report.unmatched.back()))
	return false

func prepare(path: String, snapshot: Dictionary) -> bool:
	if path.is_empty(): return true
	report.enabled=true
	var bytes: PackedByteArray=FileAccess.get_file_as_bytes(path)
	if _hash(bytes)!=PROOF_SHA:
		return _reject("Frozen GL projection SHA256 differs from committed proof",_hash(bytes))
	var audit: Variant=JSON.parse_string(bytes.get_string_from_utf8())
	if not audit is Dictionary or audit.get("schema","")!="gh-godot-gl-audit-proof-v1" or audit.get("sourceAudit",{}).get("sha256","")!=AUDIT_SHA: return _reject("Frozen proof schema/original audit provenance mismatch")
	if snapshot.source.get("coreSHA256","")!=CORE or snapshot.source.get("quality","")!="high":
		return _reject("GL High setQuality proof is limited to reviewed b3b High source",snapshot.source)
	var audited: Array=[]
	for m in audit.materials.values():
		if _flags(m) and _hash(str(m.get("vertexShader","")).to_utf8_buffer())==VERTEX_SHA and _hash(str(m.get("fragmentShader","")).to_utf8_buffer())==FRAGMENT_SHA:
			audited.append(m)
	if audited.size()!=1: return _reject("Expected exactly one code-hash/flags matched source role",audited.size())
	var original: Dictionary=audited[0]
	if float(original.uniforms.uK)!=0.0: return _reject("Audited source uK must be exactly zero",original.uniforms.uK)
	var audited_owners: Array=[]
	for o in audit.objects:
		if o.materials.has(original.id): audited_owners.append(o)
	if audited_owners.size()!=1 or not _owner(audited_owners[0]) or int(audited_owners[0].vertices)!=912: return _reject("Audit unique owner identity/flags/matrix/vertices mismatch",audited_owners)
	var candidates: Array=[]
	for o in snapshot.objects:
		if _owner(o): candidates.append(o)
	if candidates.size()!=1: return _reject("Snapshot unique owner identity/flags/matrix mismatch",candidates.size())
	var owner: Dictionary=candidates[0]
	if owner.materials.size()!=1 or owner.surfaces.size()!=1 or owner.instances!=null: return _reject("Snapshot owner material/surface/instancing mismatch")
	var id: String=str(owner.materials[0])
	var material: Dictionary=snapshot.materials[id]
	var geometry: Dictionary=snapshot.geometries[owner.geometry]
	var surface: Dictionary=owner.surfaces[0]
	if not _flags(material) or geometry.index!=null or int(geometry.position.count)!=912 or not geometry.normal is Dictionary: return _reject("Snapshot material flags/index/position/normal mismatch",material)
	if surface.mode!="triangles" or int(surface.start)!=0 or int(surface.count)!=912: return _reject("Snapshot surface mode/range mismatch")
	for i in range(912):
		if int(surface.indices[i])!=i: return _reject("Snapshot index order mismatch",i)
	# GL source20274..20290 creates six sequential vertices per extruded quad.
	# Verify repeated endpoints, normals and the independently exported aT bytes.
	var attr: Dictionary=audit.attributes[audited_owners[0].geometry].attrs.aT
	var a_t: PackedByteArray=Marshalls.base64_to_raw(str(attr.data.base64))
	if a_t.size()!=912*4 or int(attr.count)!=912 or int(attr.itemSize)!=1 or attr.data.type!="Float32Array" or int(attr.stride)!=1 or bool(attr.normalized): return _reject("Audit aT storage/layout mismatch")
	for i in range(912):
		var k: int=i%6
		if a_t.decode_float(i*4)!=(1.0 if k==2 or k==4 or k==5 else 0.0): return _reject("Audit aT value pattern mismatch",i)
	for i in range(0,912,6):
		for axis in range(3):
			if geometry.position.values[i*3+axis]!=geometry.position.values[(i+3)*3+axis] or geometry.position.values[(i+2)*3+axis]!=geometry.position.values[(i+4)*3+axis]: return _reject("Snapshot repeated quad endpoints mismatch",[i,axis])
	# No other owner may share this candidate's material; no UUID cross-run link.
	for o in snapshot.objects:
		if o.id!=owner.id and o.materials.has(id): return _reject("Snapshot material unexpectedly shared by another owner",o.id)
	var port: ShaderMaterial=ShaderMaterial.new()
	port.shader=SHAFT
	port.set_shader_parameter("source_k",0.0)
	# In High, source GL's initial .055 is overwritten by FX.setQuality:
	# t.soft && t.vol>0 ? 0 : .055 (source18763/20398). uK<=0 discards
	# before any time/color/normal use. Never copy other-session cosmetic values.
	mapped[id]=port
	report.ports.append({"role":"GL window shaft","source_material":id,"source_owner":owner.id,"source_path":owner.path,"audit_material":original.id,"audit_sha256":AUDIT_SHA,"projection_sha256":PROOF_SHA,"vertex_sha256":VERTEX_SHA,"fragment_sha256":FRAGMENT_SHA,"relation":"core+High quality+unique nativeID/path/flags+identity matrix+912 sequential quad vertices+aT exact source pattern; UUID not used","source_k":0,"proof":"b3b c9.high soft=true vol=20; FX.setQuality20398 sets uK0; source fragment first statement discards","geometry_retained":true,"visibility_changed":false,"shadow_policy_changed":false})
	for m in snapshot.materials.values():
		if bool(m.shaderMaterial) and not mapped.has(m.id): report.unsupported.append({"material":m.id,"reason":"Source shader role remains untranslated; scalar proxy remains unsafe for visual acceptance"})
	return true

func material(id: String) -> Material:
	return mapped.get(id,null)
