extends Node3D
const Fixture=preload("res://fixture.gd")
var source=Fixture.new()
var viewport: SubViewport
var material: ShaderMaterial
var report_path: String="user://post-film-oracle.json"
var failed: bool=false

func sample(row: Dictionary,reference_mode: bool=false) -> Dictionary:
	source.bind(material,row,reference_mode)
	for i in range(3): await RenderingServer.frame_post_draw
	var image: Image=viewport.get_texture().get_image()
	if image.is_empty():
		failed=true
		return {"error":"Actual native image required; Dummy is not GPU evidence","pixel":[0,0,0,0]}
	var color: Color=image.get_pixel(32,32)
	return {"pixel":[color.r,color.g,color.b,color.a],"imageFormat":image.get_format()}

func delta(a: Dictionary,b: Dictionary) -> Array:
	var result: Array=[]
	for i in range(3): result.append(absf(float(a.pixel[i])-float(b.pixel[i])))
	return result

func maximum(values: Array) -> float:
	return maxf(values[0],maxf(values[1],values[2]))

func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--report="): report_path=arg.substr(9)
	if not source.load_source():
		push_error("Exact source post fixture/code required")
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
	var environment: Environment=Environment.new()
	environment.background_mode=Environment.BG_COLOR
	environment.background_color=Color.BLACK
	environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_energy=0
	environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR
	environment.tonemap_exposure=1
	var world: WorldEnvironment=WorldEnvironment.new()
	world.environment=environment
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
	shader.code=source.shader_code
	material=ShaderMaterial.new()
	material.shader=shader
	plane.material_override=material
	var rows: Array=[]
	var samples: Dictionary={}
	var invalid: int=0
	var exact: bool=true
	for row in source.cases.cases:
		var a: Dictionary=await sample(row)
		var b: Dictionary=await sample(row,true)
		var repeat: Dictionary=await sample(row)
		var difference: Array=delta(a,b)
		var aa: float=maximum(delta(a,repeat))
		if aa!=0 or (row.name!="black" and maximum(a.pixel.slice(0,3))==0): invalid+=1
		if maximum(difference)!=0: exact=false
		rows.append({"case":row,"sample":a,"reference":b,"AAmaxDiff":aa,"differencePerChannel":difference})
		samples[row.name]=a
	var witnesses: Array=[]
	for pair in source.cases.witnessPairs:
		var difference: Array=delta(samples[pair[0]],samples[pair[1]])
		witnesses.append({"pair":pair,"differencePerChannel":difference})
		if maximum(difference)==0: invalid+=1
	var report: Dictionary={"schema":"gh-native-post-film-unit-v1","ok":not failed and invalid==0 and exact,"invalidCases":invalid,"allReferenceChannelsExact":exact,"cases":rows,"witnesses":witnesses,"engine":Engine.get_version_info(),"method":RenderingServer.get_current_rendering_method(),"driver":RenderingServer.get_current_rendering_driver_name(),"adapter":RenderingServer.get_video_adapter_name(),"proofSHA256":source.PROOF_SHA,"sourceCaptureSHA256":source.proof.sourceCaptureSHA256,"sourceCompiledFinal":source.proof.currentCompiledFinal,"fixedExposure":source.proof.sourceRead.nativeDecoded.exposure,"nativeTonemapMode":environment.tonemap_mode,"nativeTonemapExposure":environment.tonemap_exposure,"scope":source.proof.scope,"outputContract":"Source operators stop before source toSRGB; native common linear-tonemap/display OETF is applied once to both sample/reference. Returned pixel components are not assumed linear. No cross-engine literal RGB assumption.","limits":["No adaptation history or native autoexposure: actual captured source E is a fixed input","No full grade/optics/bloom/grain/scene compositor; this isolates two selected source operators","No High/material/full-game/FPS claim; exact differences recorded without tolerance"]}
	var file: FileAccess=FileAccess.open(report_path,FileAccess.WRITE)
	if file==null:
		push_error("Cannot write native film report")
		get_tree().quit(2)
		return
	file.store_string(JSON.stringify(report,"  "))
	file.close()
	print("GH_POST_FILM_UNIT "+report_path+" "+str(report.ok))
	get_tree().quit(0 if report.ok else 2)
