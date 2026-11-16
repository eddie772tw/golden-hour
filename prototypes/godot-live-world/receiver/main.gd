extends Node3D
const Wire = preload("res://protocol.gd")
const NativeSkin = preload("res://native_skin.gd")
const PropLibrary=preload("res://prop_library.gd")
const WorldScaffold=preload("res://world_scaffold.gd")
var prop_library: GHOriginalPropLibrary
var world_scaffold: GHOptionalWorldScaffold
var world_ready: bool=false
const WarmGate=preload("res://warmup_gate.gd")
var warm_gate=WarmGate.new()
var warm_active: bool=false
var warm_started_ms: float=0.0
var warm_saved_camera: Transform3D
var warm_saved_roots: Array=[]
var warm_saved_instances: Array=[]
var warm_overlay: CanvasLayer
var sync_started_ms: float=0.0
var sync_sample_count: int=0
var warmup_report: Dictionary={"schema":"gh-observed-gpu-warmup-v1","validGPUBarrier":false,"headlessControlBypass":false,"phases":[],"readback":{},"clockGateValid":false,"livePipelineRows":[],"limits":["Cumulative completion counters do not expose pending job counts; stable real draws plus readback are observed evidence, not a universal future-pipeline guarantee.","Only current original world/props/constructor skins are warmed; unported temp/weapon/FX/K9/FP features remain gaps.","Warmup uses original immutable asset matrices, never advances source AI/controller or fabricates game ticks."]}
var peer: StreamPeerTCP = StreamPeerTCP.new()
var rx: PackedByteArray = PackedByteArray()
var args: Dictionary = {}
var templates: Array = []
var skins: Dictionary = {}
var owners: Dictionary = {}
var hello: Dictionary = {}
var done: Dictionary = {}
var camera: Camera3D
var report_path: String = "user://live-receiver.json"
var capture_path: String = ""
var finished: bool = false
var connected: bool = false
var started: bool = false
var headless: bool = false
var boot_ms: float = 0.0
var last_ping_ms: float = -10000.0
var ping_seq: int = 1000000
var node_minus_client: Variant = null
var best_rtt_ms: float = INF
var last_source: Dictionary = {}
var last_draw_seq: int = 0
var last_draw_tick: int = -1
var last_draw_ms: float = 0.0
var last_packet_ms: float = 0.0
var events: Array = []
var frames: Array = []
var applications: Array = []
var clock_samples: Array = []
var stats: Dictionary = {"posePackets":0,"ACKs":0,"sequenceGaps":0,"sourceSuperseded":0,"maxBufferedBytes":0,
	"wireBytes":0,"liveDraws":0,"distinctDrawTicks":0,"staleDraws":0,"appliedNotDrawn":0,"rowDrops":0,
	"visibleBotRigs":0,"hiddenBotRigs":0,"firstPersonSuppressed":0,"unmappedBodyRecords":0,"unmappedK9Records":0,
	"latestBodies":0,"latestK9":0,"nonDefaultProjectionFrames":0,"cameraAspectMismatchFrames":0}
const ROW_CAP: int = 20000

func _now() -> float: return Time.get_ticks_usec()/1000.0
func _event(name: String,extra: Dictionary = {}) -> void:
	var item: Dictionary = {"event":name,"monoMs":_now(),"epochMs":Time.get_unix_time_from_system()*1000.0}
	item.merge(extra)
	if events.size()<128: events.append(item)
	print("GH_LIVE_CLIENT " + JSON.stringify(item))

func _ready() -> void:
	boot_ms=_now()
	headless=DisplayServer.get_name()=="headless"
	Engine.max_fps=60
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--") and arg.contains("="):
			var pair: PackedStringArray=arg.substr(2).split("=",true,1)
			args[pair[0]]=pair[1]
	report_path=str(args.get("report",report_path))
	capture_path=str(args.get("capture",""))
	if FileAccess.file_exists(report_path) or (not capture_path.is_empty() and FileAccess.file_exists(capture_path)):
		finished=true
		push_error("Refusing to overwrite live evidence")
		get_tree().quit(2)
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(report_path).get_base_dir())
	if not capture_path.is_empty(): DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(capture_path).get_base_dir())
	_event("process-entry",{"headless":headless})
	var default_packet: String=ProjectSettings.globalize_path("res://").path_join("../../godot-skin-component/evidence/operators.skin.json").simplify_path()
	var path: String=str(args.get("packet",args.get("skin-packet",default_packet)))
	for team in [0,1]:
		var template=NativeSkin.new()
		template.configure(path,team)
		templates.append(template)
	camera=Camera3D.new()
	add_child(camera)
	camera.current=true
	var light: DirectionalLight3D=DirectionalLight3D.new()
	light.rotation_degrees=Vector3(-40,-30,0)
	add_child(light)
	var environment: WorldEnvironment=WorldEnvironment.new()
	var settings: Environment=Environment.new()
	settings.background_mode=Environment.BG_COLOR
	settings.background_color=Color(0.06,0.07,0.09)
	settings.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color=Color.WHITE
	settings.ambient_light_energy=0.5
	environment.environment=settings
	add_child(environment)
	if not str(args.get("world", "")).is_empty():
		light.free()
		environment.free() # Capture supplies its own lights/environment; no extra skin-smoke light.
	var prop_path: String=str(args.get("prop-assets",""))
	if not prop_path.is_empty():
		prop_library=PropLibrary.new()
		add_child(prop_library)
		prop_library.load_assets(prop_path)
		if not prop_library.loaded: _fail("Original rest prop assets failed to load");return
	_event("assets-ready",{"assetLoadMs":_now()-boot_ms,"source":templates[0].packet.source})
	var port: int=int(args.get("port","48921"))
	if port<1024 or port>65535: _fail("Invalid port");return
	if peer.connect_to_host("127.0.0.1",port)!=OK: _fail("TCP connect failed");return
	last_packet_ms=_now()
	if not headless: RenderingServer.frame_post_draw.connect(_after_draw)
	set_process(true)

func _process(_delta: float) -> void:
	if finished: return
	peer.poll()
	var status: int=peer.get_status()
	if status==StreamPeerTCP.STATUS_CONNECTED:
		if not connected:
			connected=true
			peer.set_no_delay(true)
			_event("connected")
		var available: int=peer.get_available_bytes()
		if available>0:
			if rx.size()+available>Wire.MAX_PACKET*2: _fail("Inbound buffer cap");return
			var part: Array=peer.get_partial_data(available)
			if part[0]!=OK: _fail("TCP read failed");return
			rx.append_array(part[1])
			stats.wireBytes+=part[1].size()
			stats.maxBufferedBytes=maxi(stats.maxBufferedBytes,rx.size())
			_drain()
		if not hello.is_empty() and _now()-last_ping_ms>=1000.0: _ping()
	elif status in [StreamPeerTCP.STATUS_ERROR,StreamPeerTCP.STATUS_NONE]:
		if done.is_empty(): _fail("Source disconnected before DONE");return
	if not done.is_empty() and headless: _finish();return
	if _now()-boot_ms>float(args.get("max-seconds","240"))*1000.0: _fail("Receiver wall timeout");return
	if warm_active and _now()-warm_started_ms>float(args.get("warmup-timeout","90"))*1000.0: _restore_warmup();_fail("Observed GPU warmup timed out; no START sent");return
	if started and _now()-last_packet_ms>10000.0: _fail("No source/control packet for10seconds")

func _drain() -> void:
	var count: int=0
	while rx.size()>=4 and not finished:
		var length: int=rx.decode_u32(0)+4
		if length<Wire.HEADER or length>Wire.MAX_PACKET: _fail("Invalid packet length");return
		if rx.size()<length: return
		var bytes: PackedByteArray=rx.slice(0,length)
		rx=rx.slice(length)
		var message: Dictionary=Wire.decode(bytes)
		if message.has("error"): _fail(str(message.error));return
		last_packet_ms=_now()
		if message.kind==Wire.HELLO: _hello(message.payload)
		elif message.kind==Wire.CLOCK: _clock(message)
		elif message.kind==Wire.POSE: _pose(message)
		elif message.kind==Wire.DONE:
			done=message.payload
			_event("source-done",done)
		count+=1
		if count>32: _fail("Too many source packets per process callback");return

func _send(kind: int,seq: int=0,tick: int=0,mono: float=0.0) -> void:
	if peer.put_data(Wire.control(kind,seq,tick,mono))!=OK: _fail("TCP control write failed")

func _hello(value: Dictionary) -> void:
	if not hello.is_empty(): _fail("Repeated HELLO");return
	if value.get("schema","")!="gh-live-pose-v1" or value.get("protocol","")!="GHLP-v1": _fail("Unknown source schema");return
	if value.get("coreSHA256","")!=templates[0].packet.source.coreSHA256: _fail("Source/rest core hash differs");return
	if value.skins.size()!=19: _fail("Expected original player FPbody plus9x2 bot rigs");return
	for asset in value.operatorAssets:
		var source: Dictionary=templates[int(asset.team)].asset
		for key in ["position","skinIndex","skinWeight"]:
			if source.attributes[key].sha256!=asset[key+"SHA256"]: _fail("Source/rest attribute hash differs:"+key);return
	for owner in value.skins:
		var id: int=int(owner.id)
		if skins.has(id) or int(owner.bones)!=34: _fail("Duplicate/unproved source rig");return
		var expected: int=0 if bool(owner.firstPerson) else 1+(int(owner.actor)-1)*2+int(owner.rigIndex)
		if id!=expected or int(owner.team) not in [0,1] or (not bool(owner.firstPerson) and (int(owner.actor)<1 or int(owner.actor)>9 or int(owner.rigIndex) not in [0,1])):
			_fail("Source actor/rig identity violates original owner map");return
		var skin=NativeSkin.new()
		skin.configure_shared(templates[int(owner.team)])
		skin.name="native_actor_%d_rig_%d_id_%d"%[int(owner.actor),int(owner.rigIndex),id]
		skin.set_meta("native_owner",owner)
		add_child(skin)
		skins[id]=skin
		owners[id]=owner
	hello=value
	if prop_library!=null:
		prop_library.bind_source(hello)
		if not prop_library.bound: _fail("Original prop identity did not bind");return
	var world_path: String=str(args.get("world",""))
	if not world_path.is_empty():
		_event("world-load-start")
		world_scaffold=WorldScaffold.new()
		add_child(world_scaffold)
		world_scaffold.load_capture(world_path,hello,prop_library,Callable(),args)
		if world_scaffold.report.is_empty(): _fail("World barrier failed");return
		var settings: Environment=Environment.new()
		settings.background_mode=Environment.BG_COLOR
		var bg: Variant=world_scaffold.source.get("background")
		settings.background_color=Color(float(bg[0]),float(bg[1]),float(bg[2])) if bg is Array else Color(0.05,0.04,0.03)
		settings.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
		settings.ambient_light_color=Color.WHITE
		settings.ambient_light_energy=float(world_scaffold.source.get("environmentIntensity",0.24))
		settings.tonemap_mode=Environment.TONE_MAPPER_ACES if str(args.get("tonemap","linear"))=="aces" else Environment.TONE_MAPPER_LINEAR
		var environment: WorldEnvironment=WorldEnvironment.new()
		environment.environment=settings
		add_child(environment)
		get_viewport().msaa_3d=Viewport.MSAA_4X
		get_viewport().use_occlusion_culling=false
		# Original captured camera is a cold preview only. Live camera ownership
		# starts with POSE; it is never replaced by this snapshot during AI.
		var preview: Dictionary=world_scaffold.source.camera
		camera.transform=_matrix(PackedFloat32Array(preview.matrix))
		camera.fov=rad_to_deg(2.0*atan(1.0/float(preview.projection[5])))
		camera.near=float(preview.near)
		camera.far=float(preview.far)
		_event("world-ready",{"coldLoadMs":world_scaffold.report.coldLoadMs,"categories":world_scaffold.category_counts,"propMaterials":prop_library.capture_materials if prop_library!=null else null})
	# CPU asset construction is not rendering readiness. No PING/START yet.
	_event("hello-validated",{"skins":skins.size(),"coreSHA256":value.coreSHA256,"sourceGaps":value.gaps})
	call_deferred("_begin_gpu_warmup")

func _ping() -> void:
	if not world_ready: return
	last_ping_ms=_now()
	ping_seq+=1
	_send(Wire.PING,ping_seq,0,last_ping_ms)

func _clock(message: Dictionary) -> void:
	var c3: float=_now()
	var p: Dictionary=message.payload
	if not world_ready or float(p.clientSend)<sync_started_ms: return
	var rtt: float=(c3-float(p.clientSend))-(float(p.nodeSend)-float(p.nodeReceive))
	var offset: float=((float(p.nodeReceive)-float(p.clientSend))+(float(p.nodeSend)-c3))/2.0
	if not is_finite(rtt) or not is_finite(offset) or rtt<0: _fail("Invalid clock alignment");return
	if rtt<best_rtt_ms:
		best_rtt_ms=rtt
		node_minus_client=offset
	if clock_samples.size()<256: clock_samples.append({"seq":message.seq,"clientReceiveMs":c3,"rttMs":rtt,"nodeMinusClientMs":offset})
	if not started:
		sync_sample_count+=1
		if sync_sample_count<5 or best_rtt_ms>100.0:
			if sync_sample_count>=20: _fail("Fresh post-warmup clock RTT remained above100ms; no START");return
			call_deferred("_ping")
			return
		warmup_report.clockGateValid=true
		warmup_report.clockSync={"startedAtClientMs":sync_started_ms,"samples":sync_sample_count,"bestRttMs":best_rtt_ms,"uncertaintyMs":best_rtt_ms/2.0,"maxAcceptedBestRttMs":100.0}
		started=true
		_event("start-sent",{"rttMs":best_rtt_ms,"clockUncertaintyMs":best_rtt_ms/2.0,"postWarmupSamples":sync_sample_count})
		_send(Wire.START)

func _pose(message: Dictionary) -> void:
	if not started or (not last_source.is_empty() and int(message.seq)<=int(last_source.seq)): _fail("Unowned/reordered source pose");return
	var begin: float=_now()
	var p: Dictionary=message.payload
	if p.skins.size()!=skins.size(): _fail("Incomplete source rig snapshot");return
	if not last_source.is_empty():
		stats.sequenceGaps+=int(message.seq)-int(last_source.seq)-1
		if int(last_source.seq)!=last_draw_seq and not headless: stats.appliedNotDrawn+=1
	var visible: int=0
	var hidden: int=0
	var suppressed: int=0
	var skin_flags: Array=[]
	for item in p.skins:
		if not skins.has(item.id): _fail("Unknown rig ID");return
		var owner: Dictionary=owners[item.id]
		if int(item.actor)!=int(owner.actor) or int(item.rigIndex)!=int(owner.rigIndex) or int(item.team)!=int(owner.team): _fail("Rig ownership changed");return
		var first_person: bool=bool(owner.firstPerson)
		var source_visible: bool=(int(item.flags)&1)!=0
		skin_flags.append([item.id,item.flags])
		# Effective source visibility is authoritative, including corpse rigs; actor alive is not a hide flag.
		if first_person:
			suppressed+=1
			source_visible=false # Original FPbody subset/material mapping is not ported.
		elif source_visible: visible+=1
		else: hidden+=1
		skins[item.id].apply_live_palette(item.root,item.palette,source_visible)
	stats.visibleBotRigs=visible
	stats.hiddenBotRigs=hidden
	stats.firstPersonSuppressed=suppressed
	stats.latestBodies=p.bodies.size()
	stats.latestK9=p.k9.size()
	if prop_library!=null:
		var unmapped_before: int=int(prop_library.statistics.unmappedDynamicBodyRecords)+int(prop_library.statistics.unmappedInitialBodyRecords)
		prop_library.apply_bodies(p.bodies)
		stats.unmappedBodyRecords+=int(prop_library.statistics.unmappedDynamicBodyRecords)+int(prop_library.statistics.unmappedInitialBodyRecords)-unmapped_before
	else: stats.unmappedBodyRecords+=p.bodies.size()
	stats.unmappedK9Records+=p.k9.size()
	stats.sourceSuperseded=int(p.superseded)
	_apply_camera(p)
	stats.posePackets+=1
	last_source={"seq":int(message.seq),"tick":int(message.tick),"monoMs":float(message.monoMs),"epochMs":float(message.epochMs),
		"simSeconds":float(message.simSeconds),"appliedAtClientMs":_now(),"superseded":int(p.superseded)}
	var age: Variant=(_now()+float(node_minus_client)-float(message.monoMs)) if node_minus_client!=null else null
	_record(applications,{"clientMonoMs":_now(),"seq":message.seq,"tick":message.tick,"sourceMonoMs":message.monoMs,
		"applyMs":_now()-begin,"estimatedStateAgeMs":age,"clockUncertaintyMs":best_rtt_ms/2.0,
		"visibleBotRigs":visible,"hiddenBotRigs":hidden,"skinFlags":skin_flags,"bodies":p.bodies.size(),"k9":p.k9.size(),"superseded":p.superseded})
	# ACK means applied to the native RS state, not physical presentation or a guaranteed distinct draw.
	_send(Wire.ACK,int(message.seq),int(message.tick),_now())
	stats.ACKs+=1
	if stats.posePackets==1: _event("first-pose-applied",last_source)

func _apply_camera(p: Dictionary) -> void:
	var projection: PackedFloat32Array=p.cameraProjection
	camera.transform=_matrix(p.cameraWorld)
	camera.keep_aspect=Camera3D.KEEP_HEIGHT
	camera.fov=rad_to_deg(2.0*atan(1.0/float(projection[5])))
	camera.near=float(p.camera.near)
	camera.far=float(p.camera.far)
	if absf(projection[8])>0.000001 or absf(projection[9])>0.000001: stats.nonDefaultProjectionFrames+=1
	var size: Vector2=get_viewport().get_visible_rect().size
	if absf(size.x/size.y-float(p.camera.aspect))>0.0001: stats.cameraAspectMismatchFrames+=1

func _after_draw() -> void:
	if finished: return
	var now: float=_now()
	var dt: float=now-last_draw_ms if last_draw_ms>0 else 0.0
	last_draw_ms=now
	var live: bool=not last_source.is_empty()
	var fresh: bool=live and int(last_source.tick)!=last_draw_tick
	if live:
		stats.liveDraws+=1
		if fresh: stats.distinctDrawTicks+=1
		else: stats.staleDraws+=1
		last_draw_seq=int(last_source.seq)
		last_draw_tick=int(last_source.tick)
		if stats.liveDraws==1: _event("first-live-draw",last_source)
	var age: Variant=(now+float(node_minus_client)-float(last_source.monoMs)) if live and node_minus_client!=null else null
	_record(frames,[now,dt,"live" if live else ("gpu-warmup:"+warm_gate.phase if warm_active else "waiting-source"),last_source.get("seq",0),last_source.get("tick",-1),
		last_source.get("monoMs",null),age,best_rtt_ms/2.0 if node_minus_client!=null else null,fresh,
		DisplayServer.window_is_focused(),DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_MINIMIZED,
		stats.visibleBotRigs,stats.sourceSuperseded])
	if warm_active: _warmup_draw(now,dt)
	elif live and warmup_report.livePipelineRows.size()<64: warmup_report.livePipelineRows.append([now,last_source.tick,Array(_pipeline_counts())])
	if not done.is_empty(): _finish()

func _record(array: Array,value: Variant) -> void:
	if array.size()<ROW_CAP: array.append(value)
	else: stats.rowDrops+=1

func _pipeline_counts() -> PackedInt64Array:
	return PackedInt64Array([
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_CANVAS),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_MESH),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SURFACE),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_DRAW),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_PIPELINE_COMPILATIONS_SPECIALIZATION)])

func _flat(t: Transform3D) -> PackedFloat32Array:
	return PackedFloat32Array([t.basis.x.x,t.basis.x.y,t.basis.x.z,0,t.basis.y.x,t.basis.y.y,t.basis.y.z,0,
		t.basis.z.x,t.basis.z.y,t.basis.z.z,0,t.origin.x,t.origin.y,t.origin.z,1])

func _warm_instance(node: GeometryInstance3D,original_ignore: bool) -> void:
	warm_saved_instances.append({"node":node,"ignore":original_ignore,"visible":node.visible})
	node.visible=true
	RenderingServer.instance_set_ignore_culling(node.get_instance(),true)

func _begin_gpu_warmup() -> void:
	if finished: return
	if headless:
		if str(args.get("allow-headless-control","0"))!="1": _fail("GPU warmup requires real Forward+ renderer; Dummy cannot pass");return
		warmup_report.headlessControlBypass=true
		_event("headless-control-unit-bypass",{"validGPUBarrier":false})
		_begin_fresh_sync()
		return
	if RenderingServer.get_current_rendering_method()!="forward_plus": _fail("Pipeline warmup candidate requires actual Forward+ renderer");return
	warm_started_ms=_now()
	warm_active=true
	warm_saved_camera=camera.transform
	if world_scaffold!=null:
		var source_camera: Dictionary=world_scaffold.source.camera
		camera.transform=_matrix(PackedFloat32Array(source_camera.matrix))
		camera.fov=rad_to_deg(2.0*atan(1.0/float(source_camera.projection[5])))
		camera.near=float(source_camera.near)
		camera.far=float(source_camera.far)
		for item in world_scaffold.importer.snapshot.objects:
			if world_scaffold.importer.objects.has(item.id): _warm_instance(world_scaffold.importer.objects[item.id],not bool(item.frustumCulled))
	if prop_library!=null:
		for prop in prop_library.packet.props:
			var index: int=int(prop.sourcePropIndex)
			var node: Node3D=prop_library.prop_roots[index]
			warm_saved_roots.append({"node":node,"transform":node.transform,"visible":node.visible})
			var q: Array=prop.homeQ
			var scale_value: Array=prop.rootInitialScale
			var basis: Basis=Basis(Quaternion(float(q[0]),float(q[1]),float(q[2]),float(q[3]))).scaled(Vector3(scale_value[0],scale_value[1],scale_value[2]))
			node.transform=Transform3D(basis,Vector3(prop.homeP[0],prop.homeP[1],prop.homeP[2]))
			node.visible=true
		for id in prop_library.child_nodes: _warm_instance(prop_library.child_nodes[id],not bool(prop_library.child_items[id].frustumCulled))
	var visible_skins: int=0
	for id in skins:
		if bool(owners[id].firstPerson): continue
		var skin=skins[id]
		var frame: Dictionary=skin.asset.frames[0]
		if str(frame.label)!="original-constructor-joints": _fail("Warmup requires original constructor asset pose");return
		var palette: PackedFloat32Array=PackedFloat32Array()
		for i in range(skin.asset.bones.size()):
			# Exact original constructor pose metadata. Full affine matrices only;
			# this is a loading render, not playback or a fabricated logical tick.
			var affine: Transform3D=_matrix(PackedFloat32Array(frame.globalBonePoses[i]))*_matrix(PackedFloat32Array(skin.asset.bones[i].inverseBind))
			palette.append_array(_flat(affine))
		skin.apply_live_palette(PackedFloat32Array(frame.rootWorld),palette,true)
		visible_skins+=1
	warm_overlay=CanvasLayer.new()
	warm_overlay.layer=100
	var cover: ColorRect=ColorRect.new()
	cover.color=Color.BLACK
	cover.size=get_viewport().get_visible_rect().size
	cover.mouse_filter=Control.MOUSE_FILTER_IGNORE
	warm_overlay.add_child(cover)
	add_child(warm_overlay)
	warmup_report.assetSubmission={"skins":visible_skins,"props":warm_saved_roots.size(),"meshInstances":warm_saved_instances.size(),
		"skinSource":"original-constructor-joints; immutable source asset frame0","propSource":"original rootInitialScale/homeP/homeQ plus original child-local rest matrices; never inferred capture root","sourceAITicks":0}
	warmup_report.pipelineCounterNames=["canvas","mesh","surface","draw","specialization"]
	warmup_report.startedAtClientMs=warm_started_ms
	warm_gate.start("visible-original-assets",_pipeline_counts())
	_event("gpu-warmup-start",warmup_report.assetSubmission)

func _warmup_draw(now: float,dt: float) -> void:
	if warm_gate.phase=="visible-original-assets" and warm_gate.frames==0:
		warmup_report.firstWarmDrawAtClientMs=now
		warmup_report.firstWarmDrawDelayMs=now-warm_started_ms
	var viewport: RID=get_viewport().get_viewport_rid()
	var objects: int=RenderingServer.viewport_get_render_info(viewport,RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE,RenderingServer.VIEWPORT_RENDER_INFO_OBJECTS_IN_FRAME)
	var draws: int=RenderingServer.viewport_get_render_info(viewport,RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE,RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)
	var stable: bool=warm_gate.observe(now,dt,_pipeline_counts(),objects,draws)
	if not warm_gate.error.is_empty(): _fail(warm_gate.error);return
	if not stable: return
	warmup_report.phases.append({"phase":warm_gate.phase,"completedAtClientMs":now,"frames":warm_gate.frames,"quietFrames":warm_gate.quiet,"pipelineTotals":Array(_pipeline_counts())})
	if warm_gate.phase=="visible-original-assets":
		var begin: float=_now()
		# A single native viewport readback completes actual submitted work. This
		# cold synchronization cost is kept, outside the source AI/live window.
		var image: Image=get_viewport().get_texture().get_image()
		if image==null or image.is_empty(): _fail("Warmup viewport readback failed");return
		var bytes: PackedByteArray=image.get_data()
		var hash: HashingContext=HashingContext.new()
		hash.start(HashingContext.HASH_SHA256)
		hash.update(bytes)
		warmup_report.readback={"width":image.get_width(),"height":image.get_height(),"bytes":bytes.size(),"sha256":hash.finish().hex_encode(),"cpuWaitAndReadbackMs":_now()-begin,"blackLoadingOverlay":true,"visibleObjects":objects,"visibleDrawCalls":draws,"gpuTimestampQuery":false}
		_restore_warmup()
		# Camera stays at real captured view for the restored-scene settle. The
		# first source packet later remains its sole live owner.
		warm_active=true
		warm_gate.start("restored-scene",_pipeline_counts())
		_event("gpu-warmup-restored",warmup_report.readback)
	else:
		warm_active=false
		warmup_report.validGPUBarrier=true
		warmup_report.completedAtClientMs=_now()
		warmup_report.elapsedMs=_now()-warm_started_ms
		var largest_interval: float=0.0
		for row in warm_gate.rows: largest_interval=maxf(largest_interval,float(row[1]))
		warmup_report.maximumRecordedWarmupIntervalMs=largest_interval
		_event("gpu-warmup-ready",{"elapsedMs":warmup_report.elapsedMs,"pipelineTotals":Array(_pipeline_counts())})
		_begin_fresh_sync()

func _restore_warmup() -> void:
	if warm_active: camera.transform=warm_saved_camera
	for saved in warm_saved_instances:
		var node: GeometryInstance3D=saved.node
		node.visible=bool(saved.visible)
		RenderingServer.instance_set_ignore_culling(node.get_instance(),bool(saved.ignore))
	warm_saved_instances.clear()
	for saved in warm_saved_roots:
		saved.node.transform=saved.transform
		saved.node.visible=bool(saved.visible)
	warm_saved_roots.clear()
	for id in skins:
		var skin=skins[id]
		if not skin.dummy and skin.instance_rid.is_valid(): RenderingServer.instance_set_visible(skin.instance_rid,false)
	if warm_overlay!=null:
		warm_overlay.free()
		warm_overlay=null
	warm_active=false

func _begin_fresh_sync() -> void:
	world_ready=true
	node_minus_client=null
	best_rtt_ms=INF
	clock_samples.clear()
	sync_sample_count=0
	sync_started_ms=_now()
	warmup_report.syncStartedAtClientMs=sync_started_ms
	_event("post-warmup-clock-sync")
	_ping()

func _actual_render_settings() -> Dictionary:
	var tone: Variant=null
	for child in get_children():
		if child is WorldEnvironment: tone=child.environment.tonemap_mode
	var texture: ViewportTexture=get_viewport().get_texture()
	var size: Vector2=get_viewport().get_visible_rect().size
	var window: Vector2i=DisplayServer.window_get_size()
	return {"viewport":[size.x,size.y],"renderTarget":[texture.get_width(),texture.get_height()],"window":[window.x,window.y],
		"msaa3D":get_viewport().msaa_3d,"directionalShadowSize":ProjectSettings.get_setting("rendering/lights_and_shadows/directional_shadow/size"),
		"directionalShadowSizeOwner":"ProjectSettings configured atlas size; not GPU texture readback",
		"positionalShadowAtlasSize":get_viewport().positional_shadow_atlas_size,"tonemapMode":tone,"useOcclusionCulling":get_viewport().use_occlusion_culling,
		"scaling3DScale":get_viewport().scaling_3d_scale,"vsyncMode":DisplayServer.window_get_vsync_mode(),
		"renderingMethod":RenderingServer.get_current_rendering_method(),"renderingDriver":RenderingServer.get_current_rendering_driver_name()}

func _matrix(m: PackedFloat32Array) -> Transform3D:
	return Transform3D(Basis(Vector3(m[0],m[1],m[2]),Vector3(m[4],m[5],m[6]),Vector3(m[8],m[9],m[10])),Vector3(m[12],m[13],m[14]))

func _fail(reason: String) -> void:
	if finished: return
	if warm_active: _restore_warmup()
	_event("failure",{"reason":reason})
	_finish(reason)

func _finish(error: String = "") -> void:
	if finished: return
	finished=true
	set_process(false)
	var report: Dictionary={"schema":"gh-live-world-warmup-receiver-v1","ok":error.is_empty() and not done.is_empty() and stats.posePackets>0,
		"error":error,"headless":headless,"godot":Engine.get_version_info(),"sourceHello":hello,"sourceDone":done,
		"sourceRestPacket":templates[0].packet.source if not templates.is_empty() else null,
		"statistics":stats,"events":events,"frameFields":["clientMonoMs","intervalMs","phase","sourceSeq","sourceTick","sourceMonoMs",
			"estimatedStateAgeMs","clockUncertaintyMs","distinctTick","focusedAtDraw","minimizedAtDraw","visibleBotRigs","sourceSuperseded"],
		"frames":frames,"applications":applications,"clockSamples":clock_samples,
		"clock":{"nodeMinusClientMs":node_minus_client,"bestRttMs":best_rtt_ms if node_minus_client!=null else null,
			"uncertaintyMs":best_rtt_ms/2.0 if node_minus_client!=null else null,"model":"minimum-RTT four-timestamp monotonic alignment; not input-to-photon"},
		"worldScaffold":world_scaffold.report if world_scaffold!=null else null,
		"propRestAssets":{"metadataPath":prop_library.metadata_path,"metadataSHA256":prop_library.metadata_sha256,"source":prop_library.packet.source,"binary":prop_library.packet.binary,"statistics":prop_library.statistics,"captureMaterials":prop_library.capture_materials,"rootsAtFinish":prop_library.root_state_report()} if prop_library!=null else null,
		"warmup":warmup_report,"warmupFrameFields":["clientMonoMs","intervalMs","phase","pipelineTotals","pipelineDeltas","visibleObjects","visibleDrawCalls"],"warmupFrames":warm_gate.rows,"actualRenderSettings":_actual_render_settings(),
		"materialMode":str(args.get("material-mode","source-scalars")),"sourceLightUnits":"Literal source intensity; inverse-square decay copied for PointLight; units/energy not calibrated",
		"fullHighParity":false,"audioOutput":false,"fullScene":false,"bakedPoseReplay":false,
		"drawTimingOwner":"RenderingServer.frame_post_draw engine callback; not physical present or input-to-photon",
		"gpuTimeMs":null,"gpuTimestampQuery":false,
		"limits":["Real original AI source, live full affine palettes and camera; no baked vertex/recorded-pose playback.",
			"Both bot rigs are maintained, but effective native visibility controls rendering; inactive corpse can remain visible legitimately.",
			"Player first-person body is suppressed until original subset/material mapping is ported.",
			"Optional original world scaffold plus original rest prop children use true live body roots; unmapped dynamic capture records are not drawn stale. No fabricated substitute geometry.",
			"Optional frozen PBR/guarded GL backend is a component port; full High aux shading/normal law/FX/reflection/postprocess/native audible DSP remain unaccepted. Weapon/temp/K9/FP assets and child animation remain gaps.",
			"ACK is native state application; distinct draws and pose age at draw are measured separately. Physical presentation is not measured.",
			"Headless uses Dummy; it does not establish GPU rendering or FPS. All raw intervals retained, no warm-frame deletion."]}
	if not headless and error.is_empty():
		var max_palette_error: float=0.0
		for skin in skins.values(): max_palette_error=maxf(max_palette_error,skin.live_palette_readback_error())
		report["paletteReadbackMaxError"]=max_palette_error
		if not capture_path.is_empty(): report["captureError"]=get_viewport().get_texture().get_image().save_png(capture_path)
	peer.disconnect_from_host()
	var file: FileAccess=FileAccess.open(report_path,FileAccess.WRITE)
	if file==null:
		push_error("Cannot write live receiver report")
		get_tree().quit(2)
		return
	file.store_string(JSON.stringify(report,"\t"))
	print("GH_LIVE_CLIENT_REPORT "+JSON.stringify({"path":report_path,"ok":report.ok,"poses":stats.posePackets,"liveDraws":stats.liveDraws,"distinctTicks":stats.distinctDrawTicks,"error":error}))
	for template in templates: template.free()
	get_tree().quit(0 if report.ok else 2)
