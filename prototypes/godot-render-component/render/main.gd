extends Node3D
# Real frozen capture only. StandardMaterial mapping is intentionally not High parity.
var snapshot: Dictionary = {}
var materials: Dictionary = {}
var meshes: Dictionary = {}
var multimat_meshes: Dictionary = {}
const TextureBinding = preload("res://texture_binding.gd")
var texture_binding = TextureBinding.new()
const PBRAdaptor = preload("res://pbr_adaptor.gd")
var pbr_adaptor = PBRAdaptor.new()
const SourceShaders = preload("res://source_shaders.gd")
var source_shaders = SourceShaders.new()
var texture_manifest_path: String = ""
var normal_shaders: Dictionary = {}
var material_mode: String = "source-scalars"
var light_energy_scale: float = 1.0
var emission_scale: float = 1.0
var tonemap_mode: String = "linear"
var mapping_diagnostics: Dictionary = {"normal_debug_materials":0,"source_scalar_materials":0,"untranslated_shader_materials":0,"source_material_types":{},"suspect_objects":[],"no_output_mappings":[]}
var objects: Dictionary = {}
var camera: Camera3D
var report_path: String = "user://render-component.json"
var screenshot_path: String = ""
var quit_on_complete: bool = false
var warmup_frames: int = 120
var sample_frames: int = 1800
var frames: Array = []
var warm_frames: Array = []
var max_records: int = 7200
var frame_index: int = 0
var last_post_us: int = 0
var pre_us: int = 0
var loaded: bool = false
var finished: bool = false
var load_ms: float = 0.0
var import_counts: Dictionary = {"nodes":0,"multimeshes":0,"instances":0,"surfaces":0,"surface_vertex_uploads":0,"empty_objects":0,"shader_instancing_approximations":0,"multimat_mesh_variants":0}
var limitations: Array = []
var hud: Label
var pose_updates: int = 0

func _ready() -> void:
	var args: Dictionary = {}
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--") and arg.contains("="):
			var pair: PackedStringArray = arg.substr(2).split("=", true, 1)
			args[pair[0]] = pair[1]
	Engine.max_fps = int(args.get("fps-cap", "60"))
	warmup_frames = maxi(2, int(args.get("warmup-frames", "120")))
	sample_frames = clampi(int(args.get("sample-frames", "1800")), 1, max_records)
	report_path = str(args.get("report", report_path))
	screenshot_path = str(args.get("screenshot", ""))
	quit_on_complete = str(args.get("quit-on-complete", "0")) == "1"
	material_mode = str(args.get("material-mode", "source-scalars"))
	light_energy_scale = maxf(0.0,float(args.get("light-energy-scale", "1")))
	emission_scale = maxf(0.0,float(args.get("emission-scale", "1")))
	tonemap_mode = str(args.get("tonemap", "linear"))
	texture_manifest_path = str(args.get("textures", ""))
	if not material_mode in ["source-scalars","normal-debug","pbr-adaptor"] or not tonemap_mode in ["linear","aces"]:
		_fail("Unsupported diagnostic material-mode/tonemap")
		return
	var path: String = str(args.get("snapshot", "res://scene.snapshot.json"))
	var start: int = Time.get_ticks_usec()
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		_fail("Real capture required; cannot open " + path)
		return
	var data: Variant = JSON.parse_string(file.get_as_text())
	if not data is Dictionary or data.get("schema", "") != "gh-godot-render-snapshot-v1":
		_fail("Invalid real-scene snapshot schema")
		return
	snapshot = data
	if not texture_manifest_path.is_empty() and not texture_binding.load_manifest(texture_manifest_path,snapshot):
		_fail("Texture manifest/session/core/material IDs do not match this geometry snapshot")
		return
	if material_mode=="pbr-adaptor":
		if texture_manifest_path.is_empty():
			_fail("Explicit pbr-adaptor mode requires the same-session texture manifest")
			return
		pbr_adaptor.prepare(texture_binding,get_viewport(),emission_scale)
	if snapshot.get("source", {}).get("capturedFrom", "") != "GH.debug.gfx.scene" or snapshot.get("objects", []).is_empty():
		_fail("Empty/synthetic scene is not a valid render-component capture")
		return
	limitations = snapshot.get("parity", {}).get("gaps", []).duplicate()
	var shader_audit_path: String=str(args.get("shader-audit",""))
	if not shader_audit_path.is_empty():
		if material_mode!="pbr-adaptor" or not source_shaders.prepare(shader_audit_path,snapshot):
			_fail("Explicit source shader audit/role/geometry/High proof did not match; no silent fallback")
			return
	for id in snapshot.get("materials", {}):
		materials[id] = _material(snapshot.materials[id])
	for item in snapshot.objects:
		_import_object(item)
	for light in snapshot.get("lights", []):
		_import_light(light)
	camera = Camera3D.new()
	add_child(camera)
	_apply_camera(snapshot.source.camera)
	camera.current = true
	var source_size: Array = snapshot.source.get("viewport", [1920,1080])
	DisplayServer.window_set_size(Vector2i(int(source_size[0]), int(source_size[1])))
	get_viewport().msaa_3d = Viewport.MSAA_4X
	get_viewport().use_occlusion_culling = false
	var environment: Environment = Environment.new()
	environment.background_mode = Environment.BG_COLOR
	var bg: Variant = snapshot.source.get("background")
	environment.background_color = _color(bg) if bg is Array else Color(0.05,0.04,0.03)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color.WHITE
	environment.ambient_light_energy = float(snapshot.source.get("environmentIntensity", 0.24))
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES if tonemap_mode == "aces" else Environment.TONE_MAPPER_LINEAR
	var world_environment: WorldEnvironment = WorldEnvironment.new()
	world_environment.environment = environment
	add_child(world_environment)
	var layer: CanvasLayer = CanvasLayer.new()
	add_child(layer)
	hud = Label.new()
	hud.position = Vector2(12,12)
	hud.add_theme_color_override("font_color",Color.YELLOW)
	hud.add_theme_color_override("font_shadow_color",Color.BLACK)
	hud.add_theme_constant_override("shadow_offset_x",2)
	hud.add_theme_constant_override("shadow_offset_y",2)
	hud.text = "GEOMETRY DIAGNOSTIC — %s — NO FPS COMPARISON\nFrozen real scene: NO full AI / High / textures / custom-shader parity\nObjects: %d  surfaces: %d  MultiMeshes: %d\nLight scale: %.3f emission: %.3f tone-map: %s" % [material_mode, objects.size(), import_counts.surfaces, import_counts.multimeshes, light_energy_scale, emission_scale, tonemap_mode]
	layer.add_child(hud)
	load_ms = (Time.get_ticks_usec() - start) / 1000.0
	RenderingServer.frame_pre_draw.connect(_pre_draw)
	RenderingServer.frame_post_draw.connect(_post_draw)
	loaded = true
	print("GH_GODOT_COMPONENT_READY " + JSON.stringify({"objects":objects.size(),"source":snapshot.source,"load_ms":load_ms,"parity":false}))

func _fail(message: String) -> void:
	push_error(message)
	print("GH_GODOT_COMPONENT_FAILED " + message)
	get_tree().quit(2)

func _matrix(m: Array) -> Transform3D:
	return Transform3D(Basis(Vector3(m[0],m[1],m[2]), Vector3(m[4],m[5],m[6]), Vector3(m[8],m[9],m[10])), Vector3(m[12],m[13],m[14]))

func _color(a: Array, alpha: float = 1.0) -> Color:
	return Color(float(a[0]),float(a[1]),float(a[2]),alpha)

func _material(item: Dictionary) -> Material:
	var type_name: String = str(item.type)
	mapping_diagnostics.source_material_types[type_name] = int(mapping_diagnostics.source_material_types.get(type_name,0)) + 1
	var source_port: Material=source_shaders.material(str(item.id))
	if source_port!=null: return source_port
	if bool(item.shaderMaterial): mapping_diagnostics.untranslated_shader_materials += 1
	if material_mode == "normal-debug":
		mapping_diagnostics.normal_debug_materials += 1
		return _normal_material(item)
	if material_mode=="pbr-adaptor" and not bool(item.shaderMaterial):
		mapping_diagnostics["pbr_adaptor_materials"] = int(mapping_diagnostics.get("pbr_adaptor_materials",0))+1
		return pbr_adaptor.make_material(str(item.id))
	mapping_diagnostics.source_scalar_materials += 1
	var m: StandardMaterial3D = StandardMaterial3D.new()
	m.resource_name = str(item.get("name", item.id))
	m.albedo_color = _color(item.color, float(item.opacity))
	m.roughness = clampf(float(item.roughness),0.0,1.0)
	m.metallic = clampf(float(item.metalness),0.0,1.0)
	m.vertex_color_use_as_albedo = bool(item.vertexColors)
	m.emission_enabled = item.emissive != [0,0,0]
	m.emission = _color(item.emissive)
	m.emission_energy_multiplier = float(item.emissiveIntensity) * emission_scale
	m.no_depth_test = not bool(item.depthTest)
	if not bool(item.depthWrite): m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	if bool(item.transparent): m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if float(item.alphaTest) > 0.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = float(item.alphaTest)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED if int(item.side) == 2 else BaseMaterial3D.CULL_FRONT if int(item.side) == 1 else BaseMaterial3D.CULL_BACK
	if str(item.type) == "MeshBasicMaterial" or bool(item.shaderMaterial): m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	# Three additive=2, subtractive=3, multiply=4. Blend equations are not exact parity.
	if int(item.blending) == 2: m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	elif int(item.blending) == 3: m.blend_mode = BaseMaterial3D.BLEND_MODE_SUB
	elif int(item.blending) == 4: m.blend_mode = BaseMaterial3D.BLEND_MODE_MUL
	# Three stores these factors in linear space; Godot Color/source_color fields
	# are encoded sRGB and converted by the material shader, exactly once.
	m.albedo_color = m.albedo_color.linear_to_srgb()
	m.emission = m.emission.linear_to_srgb()
	m.vertex_color_is_srgb = false
	if not texture_manifest_path.is_empty() and not bool(item.shaderMaterial): texture_binding.apply(str(item.id),m)
	return m

func _normal_material(item: Dictionary) -> ShaderMaterial:
	# Explicit geometry-only visualization. Do not delete meshes or repair unknown
	# vertex/alpha-mask/color-write behavior silently. Keep known source raster flags.
	var modes: PackedStringArray = PackedStringArray(["unshaded"])
	modes.append("cull_disabled" if int(item.side)==2 else "cull_front" if int(item.side)==1 else "cull_back")
	if not bool(item.depthWrite): modes.append("depth_draw_never")
	if not bool(item.depthTest): modes.append("depth_test_disabled")
	if int(item.blending)==2: modes.append("blend_add")
	elif int(item.blending)==3: modes.append("blend_sub")
	elif int(item.blending)==4: modes.append("blend_mul")
	var alpha: bool = bool(item.transparent) or float(item.alphaTest)>0.0
	var key: String = ",".join(modes) + "|alpha=" + str(alpha) + "|cut=" + str(float(item.alphaTest)>0.0)
	if not normal_shaders.has(key):
		var shader: Shader = Shader.new()
		var fragment: String = "ALBEDO = vec3(0.12) + 0.68 * abs(normalize(NORMAL));"
		if alpha: fragment += " ALPHA = source_opacity;"
		if float(item.alphaTest)>0.0: fragment += " ALPHA_SCISSOR_THRESHOLD = source_alpha_cut;"
		shader.code = "shader_type spatial;\nrender_mode " + ",".join(modes) + ";\nuniform float source_opacity = 1.0;\nuniform float source_alpha_cut = 0.0;\nvoid fragment() { " + fragment + " }\n"
		normal_shaders[key] = shader
	var material: ShaderMaterial = ShaderMaterial.new()
	material.shader = normal_shaders[key]
	material.set_shader_parameter("source_opacity",float(item.opacity))
	material.set_shader_parameter("source_alpha_cut",float(item.alphaTest))
	return material

func _vec3_attribute(attribute: Dictionary) -> PackedVector3Array:
	var out: PackedVector3Array = PackedVector3Array()
	var values: Array = attribute.values
	for i in range(0, values.size(), int(attribute.itemSize)):
		out.append(Vector3(values[i],values[i+1],values[i+2]))
	return out

func _mesh(item: Dictionary) -> ArrayMesh:
	var key: String = str(item.topologyKey)
	if meshes.has(key): return meshes[key]
	var g: Dictionary = snapshot.geometries[item.geometry]
	var mesh: ArrayMesh = ArrayMesh.new()
	for surface in item.surfaces:
		var arrays: Array = []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = _vec3_attribute(g.position)
		if g.normal is Dictionary: arrays[Mesh.ARRAY_NORMAL] = _vec3_attribute(g.normal)
		if g.get("tangent") is Dictionary: arrays[Mesh.ARRAY_TANGENT] = PackedFloat32Array(g.tangent.values)
		if g.uv is Dictionary:
			var uv: PackedVector2Array = PackedVector2Array()
			for i in range(0,g.uv.values.size(),int(g.uv.itemSize)): uv.append(Vector2(g.uv.values[i],g.uv.values[i+1]))
			arrays[Mesh.ARRAY_TEX_UV] = uv
		if g.get("uv1") is Dictionary:
			var uv_secondary: PackedVector2Array = PackedVector2Array()
			for i in range(0,g.uv1.values.size(),int(g.uv1.itemSize)): uv_secondary.append(Vector2(g.uv1.values[i],g.uv1.values[i+1]))
			arrays[Mesh.ARRAY_TEX_UV2] = uv_secondary
		if g.color is Dictionary:
			var colors: PackedColorArray = PackedColorArray()
			for i in range(0,g.color.values.size(),int(g.color.itemSize)):
				colors.append(Color(g.color.values[i],g.color.values[i+1],g.color.values[i+2],g.color.values[i+3] if int(g.color.itemSize)==4 else 1.0))
			arrays[Mesh.ARRAY_COLOR] = colors
		var indices: PackedInt32Array = PackedInt32Array(surface.indices)
		var primitive: int = Mesh.PRIMITIVE_TRIANGLES
		if surface.mode == "triangles":
			# Both coordinate systems are RH/Y-up/-Z forward; Godot front faces use CW.
			for i in range(0,indices.size()-2,3):
				var swap: int = indices[i+1]
				indices[i+1] = indices[i+2]
				indices[i+2] = swap
		elif surface.mode == "lines": primitive = Mesh.PRIMITIVE_LINES
		elif surface.mode == "line_strip": primitive = Mesh.PRIMITIVE_LINE_STRIP
		elif surface.mode == "points": primitive = Mesh.PRIMITIVE_POINTS
		arrays[Mesh.ARRAY_INDEX] = indices
		mesh.add_surface_from_arrays(primitive, arrays)
		import_counts.surface_vertex_uploads += int(g.position.count)
	meshes[key] = mesh
	return mesh

func _import_object(item: Dictionary) -> void:
	var suspect_materials: Array = []
	var all_no_output: bool = not item.surfaces.is_empty()
	var no_output_proof: String = ""
	for surface in item.surfaces:
		var source_material: Dictionary = snapshot.materials[surface.material]
		var explicit_no_stencil: bool = source_material.has("stencilWrite") and not bool(source_material.stencilWrite)
		# Capture2 predates the stencil field. Match only the exact reviewed source
		# UC family under the native FP root; do not generalize unknown materials.
		var legacy_uc: bool = not source_material.has("stencilWrite") and str(snapshot.source.get("coreSHA256","")) == "b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b" and str(source_material.type) == "MeshBasicMaterial" and (str(item.name)=="fpbody-rest" or str(item.path).contains(":fpbody/"))
		var proven: bool = not bool(source_material.colorWrite) and not bool(source_material.depthWrite) and (explicit_no_stencil or legacy_uc)
		all_no_output = all_no_output and proven
		if proven: no_output_proof = "captured stencilWrite=false" if explicit_no_stencil else "b3b UC source50198/default Material stencilWrite=false2520; native fpbody owner50204/50246/50247"
	for id in item.materials:
		var source_material: Dictionary = snapshot.materials[id]
		if bool(source_material.shaderMaterial) or not bool(source_material.colorWrite):
			suspect_materials.append({"id":id,"type":source_material.type,"shaderMaterial":source_material.shaderMaterial,"colorWrite":source_material.colorWrite,"depthWrite":source_material.depthWrite,"depthTest":source_material.depthTest,"transparent":source_material.transparent,"opacity":source_material.opacity,"side":source_material.side,"blending":source_material.blending})
	if not suspect_materials.is_empty():
		mapping_diagnostics.suspect_objects.append({"id":item.id,"nativeID":item.nativeID,"name":item.name,"path":item.path,"owners":item.owners,"sourceRenderOrder":item.renderOrder,"geometry":item.geometry,"materials":suspect_materials})
	if item.surfaces.is_empty():
		import_counts.empty_objects += 1
		return
	var mesh: ArrayMesh = _mesh(item)
	var node: GeometryInstance3D
	var g: Dictionary = snapshot.geometries[item.geometry]
	var shader_instances: int = int(g.nativeInstanceCount) if g.get("nativeInstanceCount") != null else -1
	if item.instances is Dictionary or shader_instances >= 0:
		var mm: MultiMesh = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = item.instances is Dictionary and item.instances.colors is Dictionary
		mm.mesh = mesh
		mm.instance_count = int(item.instances.count) if item.instances is Dictionary else shader_instances
		for i in range(mm.instance_count):
			var transform_value: Transform3D = Transform3D.IDENTITY
			if item.instances is Dictionary: transform_value = _matrix(item.instances.matrices.slice(i*16,i*16+16))
			mm.set_instance_transform(i,transform_value)
			if mm.use_colors:
				var values: Array = item.instances.colors.values
				var width: int = int(item.instances.colors.itemSize)
				mm.set_instance_color(i,Color(values[i*width],values[i*width+1],values[i*width+2],values[i*width+3] if width==4 else 1.0))
		var multi: MultiMeshInstance3D = MultiMeshInstance3D.new()
		multi.multimesh = mm
		node = multi
		import_counts.multimeshes += 1
		import_counts.instances += mm.instance_count
		if shader_instances >= 0: import_counts.shader_instancing_approximations += 1
	else:
		var single: MeshInstance3D = MeshInstance3D.new()
		single.mesh = mesh
		node = single
		import_counts.instances += 1
	node.name = "object_" + str(item.nativeID)
	node.transform = _matrix(item.matrix)
	node.layers = int(item.layers) & 1048575
	node.visible = bool(item.visible)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if bool(item.castShadow) else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(node)
	RenderingServer.instance_set_ignore_culling(node.get_instance(), not bool(item.frustumCulled))
	if node is MeshInstance3D:
		for i in range(item.surfaces.size()):
			node.set_surface_override_material(i,materials[item.surfaces[i].material])
	elif node is MultiMeshInstance3D:
		# MultiMesh has no MeshInstance per-surface override slots. One surface can
		# use material_override; multi-surface families need an owned mesh material variant.
		if item.surfaces.size() == 1:
			node.material_override = materials[item.surfaces[0].material]
		else:
			var material_ids: Array = []
			for surface in item.surfaces: material_ids.append(surface.material)
			var variant_key: String = str(item.topologyKey) + "|" + JSON.stringify(material_ids)
			if not multimat_meshes.has(variant_key):
				var variant: ArrayMesh = mesh.duplicate()
				for i in range(item.surfaces.size()): variant.surface_set_material(i,materials[item.surfaces[i].material])
				multimat_meshes[variant_key] = variant
				import_counts.multimat_mesh_variants += 1
			node.multimesh.mesh = multimat_meshes[variant_key]
	if all_no_output:
		var action: String = "shadow_only_preserve_native_cast"
		if bool(item.castShadow):
			node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
		else:
			var invisible_shader: Shader = Shader.new()
			invisible_shader.code = "shader_type spatial; render_mode unshaded, depth_draw_never; void fragment() { ALBEDO = vec3(0.0); ALPHA = 0.0; }"
			var invisible_material: ShaderMaterial = ShaderMaterial.new()
			invisible_material.shader = invisible_shader
			node.material_override = invisible_material
			action = "alpha0_depth_never_no_native_cast"
		mapping_diagnostics.no_output_mappings.append({"id":item.id,"nativeID":item.nativeID,"name":item.name,"path":item.path,"materials":item.materials,"sourceCastShadow":item.castShadow,"sourceVisible":item.visible,"action":action,"proof":no_output_proof})
	objects[item.id] = node
	import_counts.nodes += 1
	import_counts.surfaces += item.surfaces.size()

func _import_light(item: Dictionary) -> void:
	var light: Light3D
	if item.type == "DirectionalLight": light = DirectionalLight3D.new()
	elif item.type == "PointLight": light = OmniLight3D.new()
	elif item.type == "SpotLight": light = SpotLight3D.new()
	else:
		limitations.append("Unmapped native light: " + str(item.type))
		return
	light.transform = _matrix(item.matrix)
	light.light_color = _color(item.color)
	light.light_energy = maxf(0.0,float(item.intensity)) * light_energy_scale
	light.light_cull_mask = int(item.layers) & 1048575
	light.shadow_enabled = bool(item.castShadow)
	light.visible = bool(item.visible)
	if light is OmniLight3D: light.omni_range = float(item.distance) if float(item.distance)>0 else 1000.0
	if light is SpotLight3D:
		light.spot_range = float(item.distance) if float(item.distance)>0 else 1000.0
		light.spot_angle = rad_to_deg(float(item.angle))
	add_child(light)
	if item.target is Array:
		var target_position: Vector3 = Vector3(item.target[0],item.target[1],item.target[2])
		if target_position.distance_squared_to(light.position)>0.000001:
			var up: Vector3 = Vector3.FORWARD if absf((target_position-light.position).normalized().dot(Vector3.UP))>0.99 else Vector3.UP
			light.look_at(target_position,up)

func _apply_camera(item: Dictionary) -> void:
	camera.transform = _matrix(item.matrix)
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.fov = float(item.fov)
	camera.near = float(item.near)
	camera.far = float(item.far)
	camera.cull_mask = int(item.layers) & 1048575

# Future bridge boundary only. Root/AI owner supplies real frames; no polling/network here.
# Frozen skinned vertices do not animate when this changes an actor root transform.
func apply_pose_frame(frame: Dictionary) -> void:
	for item in frame.get("objects", []):
		if objects.has(item.id):
			var node: GeometryInstance3D = objects[item.id]
			if item.has("matrix"): node.transform = _matrix(item.matrix)
			if item.has("visible"): node.visible = bool(item.visible)
	if frame.has("camera"): _apply_camera(frame.camera)
	pose_updates += 1

func _pre_draw() -> void:
	pre_us = Time.get_ticks_usec()

func _post_draw() -> void:
	if not loaded or finished: return
	var now: int = Time.get_ticks_usec()
	frame_index += 1
	if last_post_us == 0:
		last_post_us = now
		return
	var row: Dictionary = {"frame":frame_index,"post_interval_ms":(now-last_post_us)/1000.0,"pre_to_post_ms":(now-pre_us)/1000.0,
		"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"primitives":Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"objects":Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),"process_seconds":Performance.get_monitor(Performance.TIME_PROCESS),
		"frame_setup_cpu_ms":RenderingServer.call("get_frame_setup_time_cpu") if RenderingServer.has_method("get_frame_setup_time_cpu") else null}
	last_post_us = now
	if frame_index <= warmup_frames:
		if warm_frames.size()<max_records: warm_frames.append(row)
	else: frames.append(row)
	if frames.size() >= sample_frames:
		finished = true
		call_deferred("_finish")

func _optional_metadata(object: Object, method: String) -> Variant:
	return object.call(method) if object.has_method(method) else null

func _finish() -> void:
	var report: Dictionary = {"schema":"gh-godot-render-report-v1","renderOnly":true,"fullAI":false,"highParity":false,"frozenScene":true,
		"engine":Engine.get_version_info(),"os":OS.get_name(),"rendering_method":_optional_metadata(RenderingServer,"get_current_rendering_method"),
		"rendering_driver":_optional_metadata(RenderingServer,"get_current_rendering_driver_name"),"gpu":RenderingServer.get_video_adapter_name(),
		"vendor":RenderingServer.get_video_adapter_vendor(),"api":RenderingServer.get_video_adapter_api_version(),
		"configured_method":ProjectSettings.get_setting("rendering/renderer/rendering_method"),"fps_cap":Engine.max_fps,
		"viewport_msaa_3d":get_viewport().msaa_3d,"directional_shadow_size":ProjectSettings.get_setting("rendering/lights_and_shadows/directional_shadow/size"),
		"vsync":DisplayServer.window_get_vsync_mode(),"viewport":[get_viewport().get_visible_rect().size.x,get_viewport().get_visible_rect().size.y],
		"source":snapshot.source,"sourceCounts":snapshot.counts,"importCounts":import_counts,"sourceParity":snapshot.parity,
		"texture_manifest":texture_manifest_path,"texture_binding":texture_binding.report,
		"pbr_adaptor":pbr_adaptor.report if material_mode=="pbr-adaptor" else null,"source_shader_ports":source_shaders.report,"viewport_anisotropy":get_viewport().anisotropic_filtering_level,
		"mapping":{"material_mode":material_mode,"unknown_shader_source_scalar_fallback":"untranslated source ShaderMaterial becomes unshaded scalar proxy; unsafe for visual acceptance", "light_energy_scale":light_energy_scale,"emission_scale":emission_scale,"tonemap":tonemap_mode,"diagnostic_only_not_unit_conversion":true,"no_fps_comparison":true,"diagnostics":mapping_diagnostics},
		"unsupported":snapshot.unsupported,"additionalLimitations":limitations,"load_ms":load_ms,"pose_updates":pose_updates,
		"warmup_frames_requested":warmup_frames,"warmup":warm_frames,"frames":frames,"record_cap":max_records,
		"timing_model":"Native frame_post_draw intervals are engine callback wall time, not OS present/input-to-photon or GPU completion. pre_to_post includes waits and engine scheduling, not pure GPU/CPU utilization. TIME_PROCESS is native monitor seconds, not isolated submission CPU. frame_setup_cpu_ms is optional native CPU setup metric; no per-viewport GPU query enabled.",
		"memory":{"static_bytes":Performance.get_monitor(Performance.MEMORY_STATIC),"video_bytes":Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED)},
		"comparison":"No ranking against Three High/full-game: reflection/AO/FX/custom PBR/textures/VM/animation/AI/audio are not equivalent. Next compare the same captured component/pass/features separately."}
	var file: FileAccess = FileAccess.open(report_path,FileAccess.WRITE)
	if file == null:
		_fail("Cannot write diagnostic report: " + report_path)
		return
	# Capture is already finished; PNG readback/I/O must not enter sampled intervals.
	var screenshot_error: int = OK
	if not screenshot_path.is_empty():
		var image: Image = get_viewport().get_texture().get_image()
		screenshot_error = image.save_png(screenshot_path) if image != null else FAILED
		report["screenshot"] = {"path":screenshot_path,"error":screenshot_error,"outside_measurement":true}
		if screenshot_error != OK: push_error("Diagnostic screenshot failed: " + str(screenshot_error))
	file.store_string(JSON.stringify(report))
	file.close()
	print("GH_GODOT_COMPONENT_REPORT " + report_path)
	hud.text += "\nCapture complete: " + str(frames.size()) + " native intervals"
	if quit_on_complete: get_tree().quit(0 if screenshot_error == OK else 3)
