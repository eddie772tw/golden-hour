extends "res://base_oracle.gd"
var mip_texture: DrawableTexture2D
var witness: DrawableTexture2D
var copy_material: ShaderMaterial
var probe_material: ShaderMaterial
var mirror_texture: Texture2D
var pending_mip := false
var refresh_busy := false
var request_serial := 0
var ready_serial := 0
var phase := "color"
var cpu_submissions: Array = []
var gpu_intervals: Array = []
var gpu_seen: Dictionary = {}
var submission_drops := 0
var last_copy_error := ""

func _setup_mips() -> void:
	# Node getter stays on main; render-thread work receives only the retained resource.
	mirror_texture = mirror.get_texture()
	mip_texture = DrawableTexture2D.new()
	mip_texture.setup(960,540,DrawableTexture2D.DRAWABLE_FORMAT_RGBAH,Color(0,0,0,1),true)
	witness = DrawableTexture2D.new()
	witness.setup(1,1,DrawableTexture2D.DRAWABLE_FORMAT_RGBAH,Color(0,0,0,1),false)
	copy_material = ShaderMaterial.new()
	copy_material.shader = load("res://copy.gdshader")
	probe_material = ShaderMaterial.new()
	probe_material.shader = load("res://probe.gdshader")
	receiver_material.set_shader_parameter("reflection_texture",mip_texture)

func _request_update() -> bool:
	var accepted := super._request_update()
	if accepted:
		request_serial += 1
		pending_mip = true
	return accepted

func _after_draw() -> void:
	super._after_draw()
	if pending_mip and not refresh_busy and mip_texture != null:
		pending_mip = false
		refresh_busy = true
		RenderingServer.call_on_render_thread(_refresh_mips.bind(request_serial,phase))

func _refresh_mips(serial: int, owner_phase: String) -> void:
	var rd := RenderingServer.get_rendering_device()
	if rd == null:
		_accept_refresh.call_deferred({"error":"RD absent","serial":serial})
		return
	# Source1727..1862 records and closes a draw list synchronously;1990..2014
	# records real per-level copy work. These bracket actual command recording.
	var label := "GHReflMip/" + owner_phase + "/" + str(serial)
	rd.capture_timestamp(label+"/copy.begin")
	var begin := Time.get_ticks_usec()
	mip_texture.blit_rect(Rect2i(0,0,960,540),mirror_texture,Color.WHITE,0,copy_material)
	var copied := Time.get_ticks_usec()
	rd.capture_timestamp(label+"/copy.end")
	mip_texture.generate_mipmaps()
	var generated := Time.get_ticks_usec()
	rd.capture_timestamp(label+"/chain.end")
	var groups: Dictionary = {}
	for i in rd.get_captured_timestamps_count():
		var name := rd.get_captured_timestamp_name(i)
		if not name.begins_with("GHReflMip/"): continue
		var parts := name.split("/")
		if parts.size()!=4: continue
		var key := parts[1]+"/"+parts[2]
		if not groups.has(key): groups[key]={"phase":parts[1],"serial":int(parts[2]),"frame_token":rd.get_captured_timestamps_frame()}
		groups[key][parts[3]]=[rd.get_captured_timestamp_cpu_time(i),rd.get_captured_timestamp_gpu_time(i)]
	var completed: Array = []
	for group in groups.values():
		if not (group.has("copy.begin") and group.has("copy.end") and group.has("chain.end")): continue
		var b: Array = group["copy.begin"]
		var c: Array = group["copy.end"]
		var e: Array = group["chain.end"]
		completed.append({"phase":group.phase,"serial":group.serial,"frame_token":group.frame_token,
			"capture_cpu_us":b[0],"copy_gpu_ms":(c[1]-b[1])/1e6,"generate_gpu_ms":(e[1]-c[1])/1e6,
			"total_gpu_ms":(e[1]-b[1])/1e6})
	_accept_refresh.call_deferred({"serial":serial,"phase":owner_phase,"thread_id":OS.get_thread_caller_id(),
		"on_render_thread":RenderingServer.is_on_render_thread(),"copy_submit_ms":(copied-begin)/1000.0,
		"generate_submit_ms":(generated-copied)/1000.0,"gpu_intervals":completed})

func _accept_refresh(value: Dictionary) -> void:
	refresh_busy = false
	if value.has("error"):
		last_copy_error = value.error
		_fail(last_copy_error)
		return
	ready_serial = maxi(ready_serial,int(value.serial))
	for row in value.gpu_intervals:
		var key := str(row.capture_cpu_us)
		if not gpu_seen.has(key):
			gpu_seen[key]=true
			if gpu_intervals.size()<512: gpu_intervals.append(row)
			else: submission_drops += 1
	value.erase("gpu_intervals")
	if cpu_submissions.size()<512: cpu_submissions.append(value)
	else: submission_drops += 1

func _run() -> void:
	for suffix in ["-mips-on.exr","-mips-off.exr"]:
		if FileAccess.file_exists(output.get_basename()+suffix):
			_fail("Refusing to overwrite an existing mip oracle artifact");return
	_setup_mips()
	for _i in 6: await RenderingServer.frame_post_draw
	for enabled in [false,true]:
		for node in markers.values(): node.material_override.set_shader_parameter("clip_enabled",enabled)
		while not _request_update(): await RenderingServer.frame_post_draw
		while ready_serial<request_serial and not finished: await RenderingServer.frame_post_draw
		if finished:return
		await RenderingServer.frame_post_draw
		var raw := mirror.get_texture().get_image()
		var copied := mip_texture.get_image()
		cases["clip_on" if enabled else "clip_off"]={"source":_scan(raw),"copied":_scan(copied),"base_compare":_compare_base(raw,copied)}
		copied.save_exr(output.get_basename()+("-mips-on.exr" if enabled else "-mips-off.exr"))
	var mip_image := mip_texture.get_image()
	var available := mip_image.get_mipmap_count()
	if available<9: _fail("Actual downloaded mip chain has fewer than9 additional levels: "+str(available));return
	var expected: Array = cases.clip_on.source.red.expected_center
	var sample_uv := Vector2(expected[0]/960.0,expected[1]/540.0)
	var lod_rows: Array = []
	phase = "witness"
	for lod in [0.0,1.0,3.0,6.0,9.0]:
		var sampled: Color = await _sample_gpu(sample_uv,lod,false,0,1,1)
		var reference := _sample_image_lod(mip_image,sample_uv,lod)
		lod_rows.append({"lod":lod,"gpu_sample":_rgb(sampled),"downloaded_mip_reference":_rgb(reference),"max_error":_error(sampled,reference)})
	var formula_rows: Array = []
	# Actual setupGameplay floor presets: marble/oak/kitchen/terrace.
	for params in [[0.0,1.0,1.0,6.5,0.0,"marble"],[0.25,0.6,0.4,7.5,1.4,"oak"],[0.5,0.55,0.5,7.5,1.0,"kitchen"],[0.8,0.22,0.2,7.0,2.4,"terrace"]]:
		var rr: float=params[0]
		var lod:float=rr*params[3]+params[4]
		var radiance := _sample_image_lod(mip_image,sample_uv,lod)
		var factor: float=(0.055+0.945*pow(clampf(1.0-params[2],0,1),5))*pow(1.0-rr,2)*params[1]
		var reference := Color(minf(radiance.r,9)*factor,minf(radiance.g,9)*factor,minf(radiance.b,9)*factor,1)
		var sampled: Color=await _sample_gpu(sample_uv,lod,true,rr,params[1],params[2],params[3],params[4])
		formula_rows.append({"preset":params[5],"roughness":rr,"k":params[1],"ndotv":params[2],"rough_scale":params[3],"blur":params[4],"lod":lod,
			"gpu_additive":_rgb(sampled),"source_formula_reference":_rgb(reference),"max_error":_error(sampled,reference)})
	phase="cadence"
	automatic=true
	while cadence_frames<120 and not finished:await RenderingServer.frame_post_draw
	automatic=false
	for _i in 4:await RenderingServer.frame_post_draw
	if finished:return
	var intervals:Array=[]
	for i in range(1,requested_updates.size()):intervals.append((requested_updates[i]-requested_updates[i-1])/1000.0)
	var shortest:=1e9
	for gap in intervals:shortest=minf(shortest,gap)
	var passed:bool=cases.clip_off.source.magenta.count>10 and cases.clip_on.source.magenta.count==0
	passed=passed and absf(cases.clip_on.copied.max_rgb-4)<0.2 and shortest>=33.334 and submission_drops==0
	for key in ["red","green","blue"]:passed=passed and cases.clip_on.source[key].center_error_pixels<8.0
	for key in cases:passed=passed and cases[key].base_compare.max_error<0.005
	for row in lod_rows:passed=passed and row.max_error<0.03
	for row in formula_rows:passed=passed and row.max_error<0.03
	passed=passed and lod_rows[0].gpu_sample[0]>3.5 and lod_rows[-1].gpu_sample[0]<0.25
	var sampling_passed:=passed
	var gpu_timing_valid:=not gpu_intervals.is_empty()
	var observed_serials:Dictionary={}
	for row in gpu_intervals:
		gpu_timing_valid=gpu_timing_valid and row.copy_gpu_ms>=0 and row.generate_gpu_ms>=0 and row.total_gpu_ms>0
		observed_serials[int(row.serial)]=true
	var missing_serials:Array=[]
	for row in cpu_submissions:
		if not observed_serials.has(int(row.serial)):missing_serials.append(row.serial)
	passed=passed and gpu_timing_valid
	var report:Dictionary={"schema":"gh-planar-mip-oracle-v1","ok":passed,"highParity":false,"fullWorld":false,"AIStarted":false,
		"samplingPassed":sampling_passed,"gpuTimingValid":gpu_timing_valid,
		"engine":Engine.get_version_info(),"mipFormat":mip_image.get_format(),"actualAdditionalMipCount":available,
		"actualTotalMipLevels":available+1,"getUseMipmapsConfiguration":mip_texture.get_use_mipmaps(),
		"cases":cases,"lodSamplingWitness":lod_rows,"receiverFormulaWitness":formula_rows,
		"cadence":{"process_callbacks":cadence_frames,"post_draw_callbacks":cadence_post_draws,
			"requested_updates_us":requested_updates,"minimum_request_interval_ms":shortest,"actual_GPU_viewport_renders_counted":false},
		"overhead":{"CPU_command_submission":cpu_submissions,"GPU_queue_elapsed":gpu_intervals,
			"cadenceCPU":_cost_summary(cpu_submissions,["copy_submit_ms","generate_submit_ms"]),
			"cadenceGPU":_cost_summary(gpu_intervals,["copy_gpu_ms","generate_gpu_ms","total_gpu_ms"]),
			"gpu_results_buffered_tail_may_be_missing":true,"pending_mip":pending_mip,"refresh_busy":refresh_busy,"row_drops":submission_drops,
			"request_count":request_serial,"copy_completed_serial":ready_serial,"unobserved_GPU_serials":missing_serials,
			"GPU_coverage_complete":missing_serials.is_empty(),"drain_post_draw_callbacks":4,
			"units":"ms; CPU wall submission vs GPU queue elapsed; not physical present or exclusive utilization"},
		"limits":["Frozen marker scene, not original High/fullAI performance","Original oblique clip/normal perturbation/shadow parity unimplemented",
			"Mips copy is issued after global post_draw; main can use previous mip result for one extra frame",
			"No exposure/ACES/source final-pipeline equivalence claim","GPU timing queries add diagnostic overhead; readbacks excluded from steady submission cost"]}
	get_viewport().get_texture().get_image().save_png(output.get_basename()+"-main.png")
	var file:=FileAccess.open(output,FileAccess.WRITE)
	if file==null:_fail("Cannot write mip oracle report");return
	file.store_string(JSON.stringify(report)+"\n")
	finished=true
	print("Planar mip oracle finished: "+str(passed))
	get_tree().quit(0 if passed else 2)

func _sample_gpu(uv:Vector2,lod:float,formula:bool,roughness:float,k:float,ndotv:float,rough_scale:float=6.5,blur:float=0.0)->Color:
	probe_material.set_shader_parameter("sample_uv",uv)
	probe_material.set_shader_parameter("probe_lod",lod)
	probe_material.set_shader_parameter("apply_receiver",formula)
	probe_material.set_shader_parameter("roughness_factor",roughness)
	probe_material.set_shader_parameter("receiver_k",k)
	probe_material.set_shader_parameter("ndotv",ndotv)
	probe_material.set_shader_parameter("refl_rough",rough_scale)
	probe_material.set_shader_parameter("refl_blur",blur)
	witness.blit_rect(Rect2i(0,0,1,1),mip_texture,Color.WHITE,0,probe_material)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	return witness.get_image().get_pixel(0,0)

func _sample_image_lod(image:Image,uv:Vector2,lod:float)->Color:
	var lower:=clampi(int(floor(lod)),0,image.get_mipmap_count())
	var upper:=mini(lower+1,image.get_mipmap_count())
	return _sample_level(image,uv,lower).lerp(_sample_level(image,uv,upper),clampf(lod-lower,0,1))

func _sample_level(image:Image,uv:Vector2,level:int)->Color:
	var data:=image.get_data()
	var offset:=image.get_mipmap_offset(level)
	var end:=image.get_mipmap_offset(level+1) if level<image.get_mipmap_count() else data.size()
	var width:=maxi(1,image.get_width()>>level)
	var height:=maxi(1,image.get_height()>>level)
	var slice:=Image.create_from_data(width,height,false,image.get_format(),data.slice(offset,end))
	var x:=uv.x*width-0.5
	var y:=uv.y*height-0.5
	var x0:=int(floor(x))
	var y0:=int(floor(y))
	var a:=slice.get_pixel(clampi(x0,0,width-1),clampi(y0,0,height-1)).lerp(slice.get_pixel(clampi(x0+1,0,width-1),clampi(y0,0,height-1)),x-x0)
	var b:=slice.get_pixel(clampi(x0,0,width-1),clampi(y0+1,0,height-1)).lerp(slice.get_pixel(clampi(x0+1,0,width-1),clampi(y0+1,0,height-1)),x-x0)
	return a.lerp(b,y-y0)

func _compare_base(a:Image,b:Image)->Dictionary:
	var maximum:=0.0
	for y in a.get_height():
		for x in a.get_width():maximum=maxf(maximum,_error(a.get_pixel(x,y),b.get_pixel(x,y)))
	return {"pixels":a.get_width()*a.get_height(),"max_error":maximum}

func _rgb(c:Color)->Array:return[c.r,c.g,c.b]
func _error(a:Color,b:Color)->float:return maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b)))

func _cost_summary(rows:Array,fields:Array)->Dictionary:
	var result:Dictionary={}
	for field in fields:
		var values:Array=[]
		for row in rows:
			if row.phase=="cadence":values.append(float(row[field]))
		values.sort()
		if values.is_empty():result[field]={"count":0};continue
		var total:=0.0
		for value in values:total+=value
		result[field]={"count":values.size(),"mean":total/values.size(),"p50":values[ceili(values.size()*.5)-1],"p95":values[ceili(values.size()*.95)-1],"max":values[-1]}
	return result
