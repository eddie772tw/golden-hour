extends SceneTree
func _initialize() -> void:
	var script = load("res://mips.gd")
	assert(script is Script and script.can_instantiate())
	var api := {"DrawableTexture2D":["setup","blit_rect","generate_mipmaps","get_use_mipmaps","get_image"],
		"RenderingServer":["get_rendering_device","call_on_render_thread","is_on_render_thread"],
		"RenderingDevice":["capture_timestamp","get_captured_timestamps_count","get_captured_timestamps_frame","get_captured_timestamp_name","get_captured_timestamp_cpu_time","get_captured_timestamp_gpu_time"],
		"Image":["get_mipmap_count","get_mipmap_offset","create_from_data","get_data","get_pixel","generate_mipmaps"],
		"ShaderMaterial":["set_shader_parameter"],"OS":["get_thread_caller_id"]}
	for cls in api:
		for method in api[cls]: assert(ClassDB.class_has_method(cls,method),cls+"."+method)
	var object = script.new()
	# CPU sampler unit only. This is not the GPU witness or a fabricated GPU chain.
	var image := Image.create(8,4,false,Image.FORMAT_RGBAH)
	image.fill(Color(4,2,1,1))
	assert(image.generate_mipmaps()==OK)
	assert(image.get_mipmap_count()==3)
	for lod in [0.0,0.5,1.0,2.5,3.0,9.0]:
		for uv in [Vector2(0,0),Vector2(0.5,0.5),Vector2(1,1)]:
			assert(object._error(object._sample_image_lod(image,uv,lod),Color(4,2,1,1))<0.001)
	var gradient := Image.create(2,2,false,Image.FORMAT_RGBAH)
	gradient.set_pixel(0,0,Color(4,0,0,1));gradient.set_pixel(1,0,Color(0,4,0,1))
	gradient.set_pixel(0,1,Color(0,0,4,1));gradient.set_pixel(1,1,Color(4,4,4,1))
	assert(object._error(object._sample_image_lod(gradient,Vector2(.5,.5),0),Color(2,2,2,1))<0.001)
	object.free()
	var file := FileAccess.open("res://headless-check.json",FileAccess.WRITE)
	file.store_string(JSON.stringify({"ok":true,"engine":Engine.get_version_info(),"actualClassDBMethods":api,"scriptParsed":true,
		"cpuImageSampler":true,"GPUStarted":false,"shaderGPUCompiled":false,"actualDrawableMipChainVerified":false})+"\n")
	print("Mip script/actualAPI/CPU sampler PASS; no GPU proof")
	quit()
