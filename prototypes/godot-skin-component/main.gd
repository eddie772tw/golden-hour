extends Node3D
const LiveSkin = preload("res://live_skin.gd")
var driver: GHNativeLiveSkin
var args: Dictionary = {}
var checks: Array = []
var draws: int = 0
var camera: Camera3D
var capture_path: String = ""
var report_path: String = ""
var validate_only: bool = false

func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--") and arg.contains("="):
			var pair: PackedStringArray = arg.substr(2).split("=",true,1)
			args[pair[0]] = pair[1]
	validate_only = str(args.get("validate-only","0")) == "1"
	capture_path = str(args.get("capture",""))
	report_path = str(args.get("report",""))
	driver = LiveSkin.new()
	driver.configure(str(args.get("packet","res://evidence/operators.skin.json")),int(args.get("team","0")))
	for i in range(driver.asset.frames.size()):
		var check: Dictionary = driver.cpu_pose_error(i)
		checks.append(check)
		assert(float(check.max_position_error) < 0.00005,"Godot CPU position proof failed")
	if validate_only:
		_finish(false)
		driver.free()
		return
	add_child(driver)
	var light: DirectionalLight3D = DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-40,-30,0)
	add_child(light)
	var environment: WorldEnvironment = WorldEnvironment.new()
	var settings: Environment = Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color(0.06,0.07,0.09)
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color.WHITE
	settings.ambient_light_energy = 0.5
	environment.environment = settings
	add_child(environment)
	camera = Camera3D.new()
	add_child(camera)
	camera.current = true
	_set_pose(0)
	RenderingServer.frame_post_draw.connect(_after_draw)

func _set_pose(index: int) -> void:
	driver.apply_pose(index)
	var points: PackedVector3Array = driver._vec3(driver.asset.frames[index].nativeWorldPositionGolden)
	var bounds: AABB = AABB(points[0],Vector3.ZERO)
	for p in points: bounds = bounds.expand(p)
	var center: Vector3 = bounds.get_center()
	camera.position = center + Vector3(0.6,0.25,maxf(3.2,bounds.size.length()*1.4))
	camera.look_at(center)

func _after_draw() -> void:
	draws += 1
	# Four true original pose samples, no synthesized/interpolated bone animation.
	if draws in [3,6,9]: _set_pose(int(draws/3))
	if draws < 12: return
	RenderingServer.frame_post_draw.disconnect(_after_draw)
	_finish(true)

func _finish(rendered: bool) -> void:
	var palette_error: Variant = driver.palette_readback_error() if rendered else null
	if rendered: assert(float(palette_error) < 0.000005,"Native RS affine palette readback failed")
	var report: Dictionary = {"kind":"original-native-rest-skin-affine-proof","godot":Engine.get_version_info(),
		"source":driver.packet.source,"team":driver.asset.team,"bones":driver.asset.bones.size(),"vertices":driver.asset.vertices,
		"cpu_pose_checks":checks,"native_render_smoke":rendered,"palette_readback_error":palette_error,
		"frames_drawn":draws,"pose_samples":driver.asset.frames.size(),"high_parity":false,"full_ai":false,
		"gpu_vertex_positions_readback":false,"unported_attributes":driver.asset.preservedButNotMappedToGodotHigh,
		"limits":driver.packet.parity.gaps}
	if rendered and not capture_path.is_empty():
		var image: Image = get_viewport().get_texture().get_image()
		report["capture_error"] = image.save_png(capture_path)
	if not report_path.is_empty():
		var file: FileAccess = FileAccess.open(report_path,FileAccess.WRITE)
		assert(file != null)
		file.store_string(JSON.stringify(report,"\t"))
	print("GH_NATIVE_SKIN_PROOF " + JSON.stringify(report))
	get_tree().quit(0)
