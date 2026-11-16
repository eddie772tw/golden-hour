extends SceneTree
func _initialize() -> void:
	var script = load("res://oracle.gd")
	assert(script is Script and script.can_instantiate())
	var api := {"RenderingServer":["get_rendering_device"],"Camera3D":["get_camera_projection","look_at_from_position"],
		"Viewport":["get_world_3d","set_world_3d","get_texture","set_use_hdr_2d"],
		"SubViewport":["set_update_mode","set_size"],"Image":["get_pixel","get_format","save_exr","save_png"],
		"ShaderMaterial":["set_shader_parameter"]}
	for cls in api:
		for method in api[cls]: assert(ClassDB.class_has_method(cls,method),cls+"."+method)
	var p := Vector3(0,2.3,6)
	var original := Transform3D(Basis.IDENTITY,p).looking_at(Vector3(0,0.9,0),Vector3.UP)
	var f := -original.basis.z
	var u := original.basis.y
	var mirrored := Transform3D(Basis.IDENTITY,Vector3(p.x,-p.y,p.z)).looking_at(Vector3(p.x,-p.y,p.z)+Vector3(f.x,-f.y,f.z),Vector3(u.x,-u.y,u.z))
	assert(is_equal_approx(mirrored.basis.determinant(),1.0))
	assert(is_equal_approx(mirrored.origin.y,-original.origin.y))
	assert((-mirrored.basis.z).distance_to(Vector3(f.x,-f.y,f.z))<1e-5)
	var projection := Projection.create_perspective(70,16.0/9.0,0.06,2500)
	var rows := []
	for point in [Vector3(-1,1,0),Vector3(1,1,0),Vector3(0,2.3,-0.7),Vector3(0,-0.7,0)]:
		var clip: Vector4 = projection * Projection(mirrored.affine_inverse()) * Vector4(point.x,point.y,point.z,1)
		assert(clip.w>0)
		var uv := Vector2(clip.x/clip.w*.5+.5,.5-clip.y/clip.w*.5)
		assert(uv.x>0 and uv.x<1 and uv.y>0 and uv.y<1)
		rows.append([uv.x,uv.y])
	var file := FileAccess.open("res://headless-check.json",FileAccess.WRITE)
	file.store_string(JSON.stringify({"ok":true,"engine":Engine.get_version_info(),"api":api,
		"mirrorMath":true,"marker_expected_uv":rows,"GDscriptParsed":true,
		"GPUStarted":false,"shaderGPUCompiled":false,"HDRVerified":false})+"\n")
	print("Planar script/API/mirror math PASS; no GPU/shader/HDR proof")
	quit()
