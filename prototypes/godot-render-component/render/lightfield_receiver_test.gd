extends SceneTree
const Binding=preload("res://lightfield_binding.gd")
const Adaptor=preload("res://pbr_adaptor.gd")
class ReceiverMaps:
	extends RefCounted
	var snapshot: Dictionary={}
	var manifest: Dictionary={"materials":{},"textures":{}}
var failures: int=0
var checks: int=0
func check(ok: bool,label: String) -> void:
	checks+=1
	print("GH_HM_RECEIVER_CHECK "+JSON.stringify({"ok":ok,"label":label}))
	if not ok: failures+=1
func _init() -> void:
	var path: String=""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--volume-bytes="): path=arg.substr(15)
	var hm=Binding.new()
	if not hm.load_source("res://fixtures/hm-source.json",path,false):
		quit(2)
		return
	# Metadata-only source-record projection. No synthetic game geometry or GPU
	# complexity claim: this exercises binding guards and actual shader creation.
	var role: Dictionary={}
	for item in hm.fixture.roles:
		if item.name=="steel": role=item;break
	var owner: Dictionary=role.owners[0]
	var source: Dictionary=role.scalarFlags.duplicate(true)
	source.merge({"id":"receiver-different-session","type":role.type,"color":role.sourceFactors.color.color,"metalness":role.sourceFactors.metalness,"roughness":role.sourceFactors.roughness,"emissive":role.sourceFactors.emissive.color,"emissiveIntensity":role.sourceFactors.emissiveIntensity,"alphaTest":0,"shaderMaterial":false})
	var indices: Variant=null
	if owner.indexCount!=null:
		indices=[]
		indices.resize(int(owner.indexCount))
	var object: Dictionary={"id":"receiver-owner-renamed","nativeID":owner.nativeID,"path":owner.path,"type":owner.type,"name":owner.name,"geometry":"counts-only","materials":[source.id],"layers":owner.layers,"renderOrder":owner.renderOrder}
	var snapshot: Dictionary={"source":{"coreSHA256":hm.fixture.source.coreSHA256,"quality":"high"},"objects":[object],"materials":{source.id:source},"geometries":{"counts-only":{"type":owner.geometryType,"position":{"count":owner.vertices},"index":indices}}}
	check(hm.match_snapshot(snapshot) and hm.matched.has(source.id),"source role matches path/nativeID/slot/metadata with deliberately different receiver UUIDs")
	var wrong: Dictionary=snapshot.duplicate(true)
	wrong.objects[0].nativeID+=1
	var bad_owner=Binding.new()
	bad_owner.fixture=hm.fixture
	check(not bad_owner.match_snapshot(wrong) and bad_owner.report.matched_materials==0,"changed owner rejected, no UUID fallback")
	wrong=snapshot.duplicate(true)
	wrong.materials[source.id].color[1]+=1e-6
	var bad_color=Binding.new()
	bad_color.fixture=hm.fixture
	check(not bad_color.match_snapshot(wrong),"changed source diffuse factor rejected exactly")
	var maps=ReceiverMaps.new()
	maps.snapshot=snapshot
	maps.manifest.materials[source.id]={"maps":{},"normalScale":role.sourceFactors.normalScale.vector,"aoMapIntensity":1.0}
	var adaptor=Adaptor.new()
	adaptor.prepare(maps,root,1.0)
	adaptor.lightfield=hm
	var material: ShaderMaterial=adaptor.make_material(source.id)
	var uniforms: Array=material.shader.get_shader_uniform_list()
	check(uniforms.size()>8 and material.shader.code.contains("EMISSION+=ghLightVolumeWorld") and not material.shader.code.contains("IRRADIANCE="),"actual native PBR shader accepts additive source diffuse/PI, not environment override")
	var clock: Vector4=material.get_shader_parameter("ghLVT")
	check(absf(clock.x-8.479888889365725)<1e-6 and not material.shader.code.contains("TIME"),"shader receives original fixture clock at native uniform precision, no TIME")
	adaptor.lightfield=null
	var control: ShaderMaterial=adaptor.make_material(source.id)
	check(not control.shader.code.contains("ghLightVolumeWorld"),"off mode keeps base shader without HM code")
	print("GH_HM_RECEIVER_RESULT "+JSON.stringify({"checks":checks,"failures":failures,"GPU":false,"fixtureOnly":"Source-record/count metadata unit test; real capture3 full-scene matching is root acceptance"}))
	quit(0 if failures==0 else 2)
