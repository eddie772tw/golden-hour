extends SceneTree
const Binding=preload("res://lightfield_binding.gd")
var failures: int=0
func check(ok: bool,label: String) -> void:
	print("GH_HM_CPU_CHECK "+JSON.stringify({"ok":ok,"label":label}))
	if not ok: failures+=1
func _init() -> void:
	var path: String=""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--volume-bytes="): path=arg.substr(15)
	var source=Binding.new()
	var loaded: bool=source.load_source("res://fixtures/hm-source.json",path,false)
	check(loaded,"fixed original fixture and exact half bytes loaded without GPU")
	if not loaded:
		quit(2)
		return
	check(source.images.size()==46 and source.raw_bytes.size()==397440 and bool(source.report.cpu_image_bytes_exact),"all native RGBAH slices reconstruct original z-major bytes")
	var cases: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://fixtures/hm-oracle-cases.json"))
	for i in range(3):
		var row: Dictionary=cases.cases[i]
		var q: Array=row.expected.q
		var x: int=roundi(q[0]*60.0-.5)
		var y: int=roundi(q[1]*9.0-.5)
		var z: int=roundi(q[2]*46.0-.5)
		var above: Color=source.images[z].get_pixel(x,y)
		var below: Color=source.images[z].get_pixel(x,y+9)
		var a: Array=row.expected.above
		var b: Array=row.expected.below
		check(absf(above.r-a[0])<1e-6 and absf(above.g-a[1])<1e-6 and absf(above.b-a[2])<1e-6 and absf(below.r-b[0])<1e-6 and absf(below.g-b[1])<1e-6 and absf(below.b-b[2])<1e-6,"true native Image agrees with original A/B half decode at center "+str(i))
	var shader: Shader=Shader.new()
	shader.code="shader_type spatial;render_mode unshaded;\n"+source.shader_source+"\nvoid fragment(){vec3 v=ghLightVolumeWorld(vec3(0.0),vec3(0.0,1.0,0.0));ALBEDO=v/(vec3(1.0)+v);}\n"
	var material: ShaderMaterial=ShaderMaterial.new()
	material.shader=shader
	var uniforms: Array=shader.get_shader_uniform_list()
	check(uniforms.size()>=8,"actual native shader parser accepts TY functions and all uniforms")
	check(float(source.fixture.uniforms.ghLVT.vector[0])==8.479888889365725,"source lighting accumulator fixed; not Godot TIME or tick seconds")
	print("GH_HM_CPU_RESULT "+JSON.stringify({"checks":7,"failures":failures,"GPU":false,"report":source.report}))
	quit(0 if failures==0 else 2)
