extends Node3D
const Wire = preload("res://protocol.gd")
const NativeSkin = preload("res://native_skin.gd")
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
	_event("hello-validated",{"skins":skins.size(),"coreSHA256":value.coreSHA256,"sourceGaps":value.gaps})
	_ping()

func _ping() -> void:
	last_ping_ms=_now()
	ping_seq+=1
	_send(Wire.PING,ping_seq,0,last_ping_ms)

func _clock(message: Dictionary) -> void:
	var c3: float=_now()
	var p: Dictionary=message.payload
	var rtt: float=(c3-float(p.clientSend))-(float(p.nodeSend)-float(p.nodeReceive))
	var offset: float=((float(p.nodeReceive)-float(p.clientSend))+(float(p.nodeSend)-c3))/2.0
	if not is_finite(rtt) or not is_finite(offset) or rtt<0: _fail("Invalid clock alignment");return
	if rtt<best_rtt_ms:
		best_rtt_ms=rtt
		node_minus_client=offset
	if clock_samples.size()<256: clock_samples.append({"seq":message.seq,"clientReceiveMs":c3,"rttMs":rtt,"nodeMinusClientMs":offset})
	if not started:
		started=true
		_event("start-sent",{"rttMs":rtt,"clockUncertaintyMs":rtt/2.0})
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
	stats.unmappedBodyRecords+=p.bodies.size() # Skin-only first gate; matrices are received, never fake-box rendered.
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
	_record(frames,[now,dt,"live" if live else "waiting-source",last_source.get("seq",0),last_source.get("tick",-1),
		last_source.get("monoMs",null),age,best_rtt_ms/2.0 if node_minus_client!=null else null,fresh,
		DisplayServer.window_is_focused(),DisplayServer.window_get_mode()==DisplayServer.WINDOW_MODE_MINIMIZED,
		stats.visibleBotRigs,stats.sourceSuperseded])
	if not done.is_empty(): _finish()

func _record(array: Array,value: Variant) -> void:
	if array.size()<ROW_CAP: array.append(value)
	else: stats.rowDrops+=1

func _matrix(m: PackedFloat32Array) -> Transform3D:
	return Transform3D(Basis(Vector3(m[0],m[1],m[2]),Vector3(m[4],m[5],m[6]),Vector3(m[8],m[9],m[10])),Vector3(m[12],m[13],m[14]))

func _fail(reason: String) -> void:
	if finished: return
	_event("failure",{"reason":reason})
	_finish(reason)

func _finish(error: String = "") -> void:
	if finished: return
	finished=true
	set_process(false)
	var report: Dictionary={"schema":"gh-live-receiver-v1","ok":error.is_empty() and not done.is_empty() and stats.posePackets>0,
		"error":error,"headless":headless,"godot":Engine.get_version_info(),"sourceHello":hello,"sourceDone":done,
		"sourceRestPacket":templates[0].packet.source if not templates.is_empty() else null,
		"statistics":stats,"events":events,"frameFields":["clientMonoMs","intervalMs","phase","sourceSeq","sourceTick","sourceMonoMs",
			"estimatedStateAgeMs","clockUncertaintyMs","distinctTick","focusedAtDraw","minimizedAtDraw","visibleBotRigs","sourceSuperseded"],
		"frames":frames,"applications":applications,"clockSamples":clock_samples,
		"clock":{"nodeMinusClientMs":node_minus_client,"bestRttMs":best_rtt_ms if node_minus_client!=null else null,
			"uncertaintyMs":best_rtt_ms/2.0 if node_minus_client!=null else null,"model":"minimum-RTT four-timestamp monotonic alignment; not input-to-photon"},
		"fullHighParity":false,"audioOutput":false,"fullScene":false,"bakedPoseReplay":false,
		"drawTimingOwner":"RenderingServer.frame_post_draw engine callback; not physical present or input-to-photon",
		"gpuTimeMs":null,"gpuTimestampQuery":false,
		"limits":["Real original AI source, live full affine palettes and camera; no baked vertex/recorded-pose playback.",
			"Both bot rigs are maintained, but effective native visibility controls rendering; inactive corpse can remain visible legitimately.",
			"Player first-person body is suppressed until original subset/material mapping is ported.",
			"Skin-only first gate: all original body/K9 transforms counted but no fabricated box/robot geometry is drawn.",
			"High materials/textures/aux shading/normal law/FX/reflection/postprocess and native audible DSP are unported.",
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
