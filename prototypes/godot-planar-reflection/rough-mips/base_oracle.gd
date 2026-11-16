extends Node3D
const REFLECTION_BIT := 524288
var camera: Camera3D
var mirror_camera: Camera3D
var mirror: SubViewport
var receiver_material: ShaderMaterial
var markers: Dictionary = {}
var output := ""
var started_us := 0
var automatic := false
var cadence_frames := 0
var cadence_post_draws := 0
var requested_updates: Array = []
var last_request_us := -1000000
var cases: Dictionary = {}
var finished := false

func _fail(message: String) -> void:
	if finished: return
	finished = true
	automatic = false
	push_error(message)
	if not output.is_empty() and not FileAccess.file_exists(output):
		var file := FileAccess.open(output, FileAccess.WRITE)
		if file != null: file.store_string(JSON.stringify({"ok":false,"error":message,"highParity":false}) + "\n")
	get_tree().quit(2)

func _ready() -> void:
	started_us = Time.get_ticks_usec()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--output="): output = arg.trim_prefix("--output=")
	if output.is_empty() or FileAccess.file_exists(output):
		output = ""
		_fail("A new --output=ABS.json is required")
		return
	for suffix in ["-main.png","-clip-on.exr","-clip-off.exr"]:
		if FileAccess.file_exists(output.get_basename()+suffix):
			output = ""
			_fail("Refusing to overwrite an existing oracle artifact")
			return
	if DisplayServer.get_name() == "headless":
		_fail("Dummy cannot validate planar rendering")
		return
	if RenderingServer.get_rendering_device() == null:
		_fail("RenderingDevice Forward+ required; Compatibility is not this HDR oracle")
		return
	if not Engine.get_version_info().get("hash", "").begins_with("ed1daf0bf"):
		_fail("Pinned Godot4.7.2 required")
		return
	Engine.max_fps = 60
	RenderingServer.frame_post_draw.connect(_after_draw)
	get_viewport().msaa_3d = Viewport.MSAA_4X
	camera = Camera3D.new()
	add_child(camera)
	camera.fov = 70.0
	camera.near = 0.06
	camera.far = 2500.0
	camera.cull_mask = 3
	camera.look_at_from_position(Vector3(0, 2.3, 6), Vector3(0, 0.9, 0), Vector3.UP)
	camera.current = true
	camera.environment = _environment(Environment.TONE_MAPPER_ACES)
	mirror = SubViewport.new()
	mirror.name = "LinearReflection960x540"
	mirror.size = Vector2i(960, 540)
	mirror.use_hdr_2d = true
	mirror.msaa_3d = Viewport.MSAA_DISABLED
	mirror.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(mirror)
	mirror.world_3d = get_world_3d()
	mirror_camera = Camera3D.new()
	mirror.add_child(mirror_camera)
	mirror_camera.environment = _environment(Environment.TONE_MAPPER_LINEAR)
	mirror_camera.cull_mask = 1 | REFLECTION_BIT
	mirror_camera.current = true
	for spec in [["red_left",Vector3(-1.0,1.0,0),Vector3(4,0,0)],
		["green_right",Vector3(1.0,1.0,0),Vector3(0,2,0)],
		["blue_high",Vector3(0,2.3,-0.7),Vector3(0,0,3)],
		["magenta_below",Vector3(0,-0.7,0),Vector3(3,0,3)]]:
		var node := MeshInstance3D.new()
		node.name = spec[0]
		var sphere := SphereMesh.new()
		sphere.radius = 0.20
		sphere.height = 0.40
		node.mesh = sphere
		node.position = spec[1]
		node.layers = 1
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var material := ShaderMaterial.new()
		material.shader = load("res://marker.gdshader")
		material.set_shader_parameter("marker_rgb", spec[2])
		node.material_override = material
		add_child(node)
		markers[spec[0]] = node
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(10, 12)
	floor_mesh.mesh = plane
	floor_mesh.layers = 2 # Receiver absent only from reflection view: no self sampling.
	floor_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	receiver_material = ShaderMaterial.new()
	receiver_material.shader = load("res://receiver.gdshader")
	receiver_material.set_shader_parameter("reflection_texture", mirror.get_texture())
	floor_mesh.material_override = receiver_material
	add_child(floor_mesh)
	_run.call_deferred()

func _environment(mode: int) -> Environment:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color.BLACK
	environment.tonemap_mode = mode
	environment.tonemap_exposure = 1.0
	environment.glow_enabled = false
	environment.adjustment_enabled = false
	environment.fog_enabled = false
	return environment

func _sync_camera() -> void:
	mirror_camera.fov = camera.fov
	mirror_camera.near = camera.near
	mirror_camera.far = camera.far
	mirror_camera.keep_aspect = camera.keep_aspect
	var p := camera.global_position
	var forward := -camera.global_basis.z
	var up := camera.global_basis.y
	var reflected_p := Vector3(p.x, -p.y, p.z)
	var reflected_forward := Vector3(forward.x, -forward.y, forward.z)
	var reflected_up := Vector3(up.x, -up.y, up.z)
	mirror_camera.look_at_from_position(reflected_p, reflected_p + reflected_forward, reflected_up)
	receiver_material.set_shader_parameter("reflection_view_projection", mirror_camera.get_camera_projection() * Projection(mirror_camera.global_transform.affine_inverse()))

func _request_update() -> bool:
	var now := Time.get_ticks_usec()
	if now - last_request_us < 33334: return false
	last_request_us = now
	requested_updates.append(now)
	_sync_camera()
	mirror.render_target_update_mode = SubViewport.UPDATE_ONCE
	return true

func _run() -> void:
	for _i in 6: await RenderingServer.frame_post_draw
	for enabled in [false, true]:
		for node in markers.values(): node.material_override.set_shader_parameter("clip_enabled", enabled)
		while not _request_update(): await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		var image := mirror.get_texture().get_image() # Diagnostic GPU readback outside cadence window.
		cases["clip_on" if enabled else "clip_off"] = _scan(image)
		image.save_exr(output.get_basename() + ("-clip-on.exr" if enabled else "-clip-off.exr"))
	automatic = true
	while cadence_frames < 120 and not finished: await RenderingServer.frame_post_draw
	automatic = false
	await RenderingServer.frame_post_draw
	if finished: return
	var intervals: Array = []
	for i in range(1, requested_updates.size()): intervals.append((requested_updates[i] - requested_updates[i-1]) / 1000.0)
	var shortest := 1e9
	for interval in intervals: shortest = minf(shortest, interval)
	var passed: bool = cases.clip_off.magenta.count > 10 and cases.clip_on.magenta.count == 0 and absf(cases.clip_on.max_rgb - 4.0) < 0.2
	for color in ["red","green","blue"]: passed = passed and cases.clip_on[color].count > 10 and cases.clip_on[color].center_error_pixels < 8.0
	passed = passed and shortest >= 33.334 and mirror.world_3d == get_world_3d()
	var report := {"schema":"gh-planar-colored-marker-oracle-v1","ok":passed,"GPUExecutedByRoot":true,
		"highParity":false,"SSRUsed":false,"fullWorld":false,"AIStarted":false,
		"engine":Engine.get_version_info(),"viewport":[get_viewport().get_visible_rect().size.x,get_viewport().get_visible_rect().size.y],
		"reflection_size":[mirror.size.x,mirror.size.y],"shared_world":mirror.world_3d == get_world_3d(),
		"reflection_hdr_2d":mirror.use_hdr_2d,"reflection_tonemap":"Linear identity, exposure1, no adjustment/glow",
		"expected_linear_HDR_red_peak":4.0,"HDR_peak_tolerance":0.2,
		"main_tonemap":"ACES once on final main output","floorExcludedFromMirrorByLayers":true,
		"clip":"worldY fragment discard on reflection-view bit; not original oblique projection",
		"cases":cases,"cadence":{"process_callbacks":cadence_frames,"post_draw_callbacks":cadence_post_draws,
			"requested_updates_us":requested_updates,"requests_include_two_color_cases":true,
			"actual_GPU_subviewport_renders_counted":false,
			"minimum_request_interval_ms":shortest,"intervals_ms":intervals,"cap_hz":30},
		"remainingGates":["GPU result requires root error-log review","No original world/AI/performance equivalence",
			"Exact oblique clip/reverseZ projection, shadow behavior and clip-crossing depth need proof",
			"Original mip rough-blur and perturbed-normal sampling unimplemented","Receiver geometry omitted from reflection only in this oracle"]}
	get_viewport().get_texture().get_image().save_png(output.get_basename()+"-main.png")
	var file := FileAccess.open(output, FileAccess.WRITE)
	if file == null: _fail("Cannot write oracle report");return
	file.store_string(JSON.stringify(report) + "\n")
	finished = true
	print("Planar marker oracle finished: " + str(passed))
	get_tree().quit(0 if passed else 2)

func _process(_delta: float) -> void:
	if finished: return
	if Time.get_ticks_usec() - started_us > 20000000: _fail("Bounded20second oracle timeout");return
	if not automatic: return
	cadence_frames += 1
	if camera.global_position.y > 0.02: _request_update()

func _after_draw() -> void:
	if automatic: cadence_post_draws += 1

func _scan(image: Image) -> Dictionary:
	var result := {"red":{"count":0,"sum":Vector2.ZERO},"green":{"count":0,"sum":Vector2.ZERO},
		"blue":{"count":0,"sum":Vector2.ZERO},"magenta":{"count":0,"sum":Vector2.ZERO},
		"format":image.get_format(),"size":[image.get_width(),image.get_height()],"max_rgb":0.0}
	for y in image.get_height():
		for x in image.get_width():
			var c := image.get_pixel(x,y)
			result.max_rgb = maxf(result.max_rgb,maxf(c.r,maxf(c.g,c.b)))
			var key := ""
			if c.r > 0.8 and c.b > 0.8 and c.g < 0.1: key = "magenta"
			elif c.r > 0.8 and c.g < 0.1 and c.b < 0.1: key = "red"
			elif c.g > 0.8 and c.r < 0.1 and c.b < 0.1: key = "green"
			elif c.b > 0.8 and c.r < 0.1 and c.g < 0.1: key = "blue"
			if not key.is_empty(): result[key].count += 1;result[key].sum += Vector2(x,y)
	for pair in [["red","red_left"],["green","green_right"],["blue","blue_high"]]:
		var row: Dictionary = result[pair[0]]
		var position: Vector3 = markers[pair[1]].global_position
		var clip: Vector4 = mirror_camera.get_camera_projection() * Projection(mirror_camera.global_transform.affine_inverse()) * Vector4(position.x,position.y,position.z,1)
		var expected := Vector2((clip.x/clip.w*0.5+0.5)*image.get_width(),(0.5-clip.y/clip.w*0.5)*image.get_height())
		row["expected_center"] = [expected.x,expected.y]
		row["centroid"] = row.sum / maxi(1,row.count)
		row["center_error_pixels"] = row.centroid.distance_to(expected)
		row["centroid"] = [row.centroid.x,row.centroid.y]
	for color in ["red","green","blue","magenta"]: result[color].erase("sum")
	return result
