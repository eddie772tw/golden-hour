extends Node
# Opt-in diagnostic only. Enable engine markers with --gpu-profile.
# No render calls, custom GPU timestamps, sync/fence, timers, or process loop.
var samples: Array = []
var boundaries: Array = []
var counts := {"pre": 0, "post": 0, "pending_skips": 0, "duplicate_results": 0,
	"samples_dropped": 0, "markers_dropped": 0, "boundaries_dropped": 0, "rd_absent": 0}
var max_samples := 240
var max_markers := 512
var max_boundaries := 960
var output_path := ""
var _active := false
var _pending := false
var _generation := 0
var _last_key := ""
var _metadata: Dictionary = {}

func start(path := "", limit := 240) -> void:
	assert(not _active)
	assert(samples.is_empty(), "One observer instance owns one capture")
	assert(Engine.get_version_info().get("hash", "").begins_with("ed1daf0bf"), "Recheck API/source for another engine version")
	assert(path.is_empty() or not FileAccess.file_exists(path), "Refusing to overwrite observer evidence")
	output_path = path
	max_samples = maxi(1, limit)
	max_boundaries = max_samples * 4
	_generation += 1
	_active = true
	_metadata = {"engine": Engine.get_version_info(), "main_thread_id": OS.get_main_thread_id(),
		"caller_thread_id": OS.get_thread_caller_id(), "display": DisplayServer.get_name(),
		"thread_model_setting": ProjectSettings.get_setting("rendering/driver/threads/thread_model"),
		"cmdline": OS.get_cmdline_args(), "rd_api_bound": ClassDB.class_has_method("RenderingDevice", "get_captured_timestamp_gpu_time"),
		"rs_profile_api_bound": ClassDB.class_has_method("RenderingServer", "get_frame_profile")}
	RenderingServer.frame_pre_draw.connect(_pre)
	RenderingServer.frame_post_draw.connect(_post)

func _boundary(kind: String) -> void:
	if boundaries.size() >= max_boundaries:
		counts.boundaries_dropped += 1
		return
	boundaries.append([kind, Time.get_ticks_usec(), Engine.get_frames_drawn(),
		OS.get_thread_caller_id(), RenderingServer.is_on_render_thread()])

func _pre() -> void:
	counts.pre += 1
	_boundary("pre")

func _post() -> void:
	counts.post += 1
	_boundary("post")
	if not _active:
		return
	if samples.size() >= max_samples:
		counts.samples_dropped += 1
		return
	if _pending:
		counts.pending_skips += 1
		return
	_pending = true
	RenderingServer.call_on_render_thread(_read.bind(_generation, Time.get_ticks_usec(), Engine.get_frames_drawn()))

func _read(generation: int, requested_us: int, requested_draw_count: int) -> void:
	# All RD access belongs to the actual render thread, including getters.
	var entered_us := Time.get_ticks_usec()
	var result := {"requested_us": requested_us, "requested_draw_count": requested_draw_count,
		"read_enter_us": entered_us, "thread_id": OS.get_thread_caller_id(),
		"is_on_render_thread": RenderingServer.is_on_render_thread(), "markers": []}
	var rd := RenderingServer.get_rendering_device()
	if rd == null:
		result["rd_absent"] = true
	else:
		result["reported_frame_token"] = rd.get_captured_timestamps_frame()
		result["frame_delay"] = rd.get_frame_delay()
		result["timestamp_count"] = rd.get_captured_timestamps_count()
		result["device"] = rd.get_device_name()
		result["api"] = rd.get_device_api_name()
		for i in mini(result.timestamp_count, max_markers):
			result.markers.append([rd.get_captured_timestamp_name(i),
				rd.get_captured_timestamp_cpu_time(i), rd.get_captured_timestamp_gpu_time(i)])
	result["read_exit_us"] = Time.get_ticks_usec()
	_accept.call_deferred(generation, result)

func _accept(generation: int, result: Dictionary) -> void:
	if generation != _generation or not _active:
		return
	_pending = false
	if result.get("rd_absent", false):
		counts.rd_absent += 1
		samples.append(result)
		return
	var markers: Array = result.markers
	# Do not equate engine frame token with the current live pose/draw callback.
	var key := str(result.reported_frame_token) + ":" + str(markers.front() if not markers.is_empty() else [])
	if key == _last_key:
		counts.duplicate_results += 1
		return
	_last_key = key
	counts.markers_dropped += maxi(0, int(result.timestamp_count) - max_markers)
	samples.append(result)

func stop() -> Dictionary:
	_active = false
	_generation += 1
	if RenderingServer.frame_pre_draw.is_connected(_pre):
		RenderingServer.frame_pre_draw.disconnect(_pre)
	if RenderingServer.frame_post_draw.is_connected(_post):
		RenderingServer.frame_post_draw.disconnect(_post)
	var report := {"schema": "godot-native-render-observer-v1", "metadata": _metadata,
		"counts": counts, "samples": samples, "boundaries": boundaries,
		"diagnostic_only": true,
		"gpu_validated": false, "physical_present_observed": false,
		"units": {"cpu": "microseconds", "gpu": "nanoseconds"},
		"pending_read_at_stop": _pending}
	if not output_path.is_empty():
		var file := FileAccess.open(output_path, FileAccess.WRITE)
		assert(file != null, "Cannot create observer report: " + output_path)
		file.store_string(JSON.stringify(report) + "\n")
	return report

func _exit_tree() -> void:
	if _active:
		stop()
