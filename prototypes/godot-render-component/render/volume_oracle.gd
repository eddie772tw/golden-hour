extends Node3D
# Actual captured volume only. Root-owned GPU sampler/TY unit oracle, not FPS.
const Binding=preload("res://lightfield_binding.gd")
var source=Binding.new()
var viewport: SubViewport
var material: ShaderMaterial
var report_path: String="user://hm-volume-oracle.json"
var volume_path: String=""
var invalid: int=0

func _sample(row: Dictionary,reference: bool=false,diffuse: bool=false,force_base: bool=false) -> Dictionary:
	var base_only: bool=bool(row.baseOnly) or force_base
	source.bind(material,base_only)
	material.set_shader_parameter("diagnostic_position",Vector3(row.position[0],row.position[1],row.position[2]))
	material.set_shader_parameter("diagnostic_normal",Vector3(row.normal[0],row.normal[1],row.normal[2]))
	var expected: Array=row.expected.value
	var value: Vector3=Vector3(expected[0],expected[1],expected[2])
	if diffuse: value=value*Vector3(.6,.4,.2)*(.75*.7/PI)
	material.set_shader_parameter("diagnostic_expected",value)
	material.set_shader_parameter("diagnostic_mode",1 if reference else 2 if diffuse else 0)
	for i in range(3): await RenderingServer.frame_post_draw
	var image: Image=viewport.get_texture().get_image()
	if image.is_empty():
		push_error("HM oracle requires actual native image, not dummy renderer")
		get_tree().quit(2)
		return {}
	var c: Color=image.get_pixel(32,32)
	return {"pixel":[c.r,c.g,c.b,c.a],"imageFormat":image.get_format(),"reference":reference,"diffuseProduct":diffuse,"baseOnly":base_only}

func _delta(a: Dictionary,b: Dictionary) -> Array:
	var result: Array=[]
	for i in range(3): result.append(absf(float(a.pixel[i])-float(b.pixel[i])))
	return result

func _max(a: Array) -> float:
	return maxf(a[0],maxf(a[1],a[2]))

func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--volume-bytes="): volume_path=arg.substr(15)
		if arg.begins_with("--report="): report_path=arg.substr(9)
	if not source.load_source("res://fixtures/hm-source.json",volume_path,true):
		push_error("Exact source HM fixture/bytes/upload required")
		get_tree().quit(2)
		return
	var cases: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://fixtures/hm-oracle-cases.json"))
	if cases.volumeSHA256!=source.fixture.asset.sha256 or cases.sourceTYSHA256!=source.fixture.sourceTYSHA256 or float(cases.clock)!=float(source.fixture.uniforms.ghLVT.vector[0]):
		push_error("CPU reference fixture/source/time mismatch")
		get_tree().quit(2)
		return
	Engine.max_fps=60
	viewport=SubViewport.new()
	viewport.size=Vector2i(65,65)
	viewport.own_world_3d=true
	viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	viewport.msaa_3d=Viewport.MSAA_DISABLED
	add_child(viewport)
	var root: Node3D=Node3D.new()
	viewport.add_child(root)
	var env: Environment=Environment.new()
	env.background_mode=Environment.BG_COLOR
	env.background_color=Color.BLACK
	env.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_energy=0
	env.tonemap_mode=Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure=1
	var world: WorldEnvironment=WorldEnvironment.new()
	world.environment=env
	root.add_child(world)
	var camera: Camera3D=Camera3D.new()
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL
	camera.size=2
	camera.position=Vector3(0,0,2)
	root.add_child(camera)
	camera.current=true
	var plane: MeshInstance3D=MeshInstance3D.new()
	var quad: QuadMesh=QuadMesh.new()
	quad.size=Vector2(2,2)
	plane.mesh=quad
	plane.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(plane)
	var shader: Shader=Shader.new()
	shader.code="shader_type spatial;render_mode unshaded;\n"+source.shader_source+"\nuniform vec3 diagnostic_position;uniform vec3 diagnostic_normal;uniform vec3 diagnostic_expected;uniform int diagnostic_mode;\nvoid fragment(){vec3 v=diagnostic_mode==1?diagnostic_expected:ghLightVolumeWorld(diagnostic_position,diagnostic_normal);if(diagnostic_mode==2){v*=vec3(0.6,0.4,0.2)*(1.0-0.25)*0.7/PI;}v=max(v,vec3(0.0));ALBEDO=v/(vec3(1.0)+v);}\n"
	material=ShaderMaterial.new()
	material.shader=shader
	plane.material_override=material
	var rows: Array=[]
	for row in cases.cases:
		var sample: Dictionary=await _sample(row)
		var reference: Dictionary=await _sample(row,true)
		var repeat: Dictionary=await _sample(row)
		var aa: float=_max(_delta(sample,repeat))
		var item: Dictionary={"name":row.name,"worldPosition":row.position,"worldNormal":row.normal,"expectedCPU":row.expected,"sample":sample,"reference":reference,"AAmaxDiff":aa,"differencePerChannel":_delta(sample,reference)}
		if aa!=0.0 or _max(sample.pixel.slice(0,3))==0.0: invalid+=1
		if row.name in ["pool-caustic-witness","chandelier-sparkle-witness"]:
			var base: Dictionary=await _sample(row,false,false,true)
			item["baseOnlyControl"]=base
			item["observedExtraWitnessPerChannel"]=_delta(sample,base)
			if _max(item.observedExtraWitnessPerChannel)==0.0: invalid+=1
		if row.name=="full-source-clock":
			var diffuse: Dictionary=await _sample(row,false,true)
			var diffuse_reference: Dictionary=await _sample(row,true,true)
			item["diffuseProduct"]=diffuse
			item["diffuseProductReference"]=diffuse_reference
			item["diffuseProductDifferencePerChannel"]=_delta(diffuse,diffuse_reference)
		rows.append(item)
	var report: Dictionary={"schema":"gh-hm-native-volume-oracle-v1","engine":Engine.get_version_info(),"renderer":RenderingServer.get_current_rendering_method(),"driver":RenderingServer.get_current_rendering_driver_name(),"adapter":RenderingServer.get_video_adapter_name(),"binding":source.report,"cases":rows,"invalidCases":invalid,
		"HDRReadbackContract":"Source positive HDR v encoded as v/(1+v), compared to identically encoded CPU reference through same native pipeline; no input clipping/no assumption that returned components are linear",
		"referenceLimits":"Independent CPU Float64 trilinear/trigonometry vs GPU float interpolation; record all differences, no automatic parity tolerance or full High claim","fixedSourceTime":cases.clock,"scope":"Actual397440B RGBAH/TY/phase/component diagnostic; not game FPS or177-material parity"}
	var output: FileAccess=FileAccess.open(report_path,FileAccess.WRITE)
	if output==null:
		push_error("Cannot write native volume oracle report")
		get_tree().quit(2)
		return
	output.store_string(JSON.stringify(report,"  "))
	output.close()
	print("GH_HM_VOLUME_ORACLE "+JSON.stringify(report))
	get_tree().quit(0 if invalid==0 else 2)
