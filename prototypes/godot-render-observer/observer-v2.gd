extends Node
# Diagnostic only. No extra frame/timer/render/fence; engine --gpu-profile owns markers.
const REQUIRED_RD := ["get_captured_timestamps_count", "get_captured_timestamps_frame",
	"get_captured_timestamp_name", "get_captured_timestamp_cpu_time", "get_captured_timestamp_gpu_time"]
const REQUIRED_RS := ["get_rendering_device", "is_on_render_thread", "call_on_render_thread"]
const OPTIONAL_RD := {"device": "get_device_name", "api_version": "get_device_api_version", "frame_delay": "get_frame_delay"}
var samples: Array = []
var boundaries: Array = []
var counts := {"pre": 0, "post": 0, "pending_skips": 0, "duplicate_results": 0,
	"samples_dropped": 0, "markers_dropped": 0, "boundaries_dropped": 0, "rd_absent": 0,
	"read_errors": 0, "pending_timeouts": 0, "stale_deliveries": 0}
var max_samples := 240
var max_markers := 512
var max_boundaries := 960
var output_path := ""
var start_error := ""
var _active := false
var _pending := false
var _pending_since_us := 0
var _serial := 0
var _generation := 0
var _last_key := ""
var _metadata: Dictionary = {}

func api_contract() -> Dictionary:
	var result := {"required": {}, "optional_rd": {}, "missing": []}
	for cls in ["RenderingDevice", "RenderingServer"]:
		var methods: Array = REQUIRED_RD if cls == "RenderingDevice" else REQUIRED_RS
		result.required[cls] = {}
		for method in methods:
			var bound := ClassDB.class_has_method(cls, method)
			result.required[cls][method] = bound
			if not bound:
				result.missing.append(cls + "." + method)
	for key in OPTIONAL_RD:
		var method: String = OPTIONAL_RD[key]
		result.optional_rd[method] = ClassDB.class_has_method("RenderingDevice", method)
	return result

func start(path := "", limit := 240) -> bool:
	var contract := api_contract()
	if _active or not samples.is_empty():
		start_error = "One observer instance owns one capture"
	elif not Engine.get_version_info().get("hash", "").begins_with("ed1daf0bf"):
		start_error = "Recheck observer API/source for another engine version"
	elif not contract.missing.is_empty():
		start_error = "Required ClassDB methods missing: " + str(contract.missing)
	elif not path.is_empty() and FileAccess.file_exists(path):
		start_error = "Refusing to overwrite observer evidence"
	elif limit < 1 or limit > 20000:
		start_error = "Sample limit outside 1..20000"
	if not start_error.is_empty():
		return false
	output_path = path
	max_samples = limit
	max_boundaries = max_samples * 4
	_generation += 1
	_active = true
	_metadata = {"engine": Engine.get_version_info(), "main_thread_id": OS.get_main_thread_id(),
		"caller_thread_id": OS.get_thread_caller_id(), "display": DisplayServer.get_name(),
		"thread_model_setting": ProjectSettings.get_setting("rendering/driver/threads/thread_model"),
		"cmdline": OS.get_cmdline_args(), "api_contract": contract}
	RenderingServer.frame_pre_draw.connect(_pre)
	RenderingServer.frame_post_draw.connect(_post)
	return true

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
	if _pending and Time.get_ticks_usec() - _pending_since_us > 250000:
		# GDScript has no exception catch. Recover a callback that failed to deliver
		# using existing frame callbacks only; never silently swallow the failure.
		counts.pending_timeouts += 1
		counts.read_errors += 1
		_store({"read_error": "pending read exceeded 250ms", "serial": _serial,
			"requested_us": _pending_since_us, "recovered_us": Time.get_ticks_usec()})
		_pending = false
	if samples.size() >= max_samples:
		counts.samples_dropped += 1
		return
	if _pending:
		counts.pending_skips += 1
		return
	_pending = true
	_pending_since_us = Time.get_ticks_usec()
	_serial += 1
	RenderingServer.call_on_render_thread(_read.bind(_generation, _serial, _pending_since_us, Engine.get_frames_drawn()))

func _read(generation: int, serial: int, requested_us: int, requested_draw_count: int) -> void:
	var result := {"requested_us": requested_us, "requested_draw_count": requested_draw_count,
		"read_enter_us": Time.get_ticks_usec(), "thread_id": OS.get_thread_caller_id(),
		"is_on_render_thread": RenderingServer.is_on_render_thread(), "markers": []}
	_collect(RenderingServer.get_rendering_device(), result)
	result["read_exit_us"] = Time.get_ticks_usec()
	_accept.call_deferred(generation, serial, result)

func _collect(rd: Object, result: Dictionary) -> void:
	if rd == null:
		result["rd_absent"] = true
		return
	for method in REQUIRED_RD:
		if not rd.has_method(method):
			result["read_error"] = "Unsupported required RD method: " + method
			return
	# Dynamic calls are guarded above against the actual object's binding table.
	var count = rd.call("get_captured_timestamps_count")
	var token = rd.call("get_captured_timestamps_frame")
	if typeof(count) != TYPE_INT or count < 0 or typeof(token) != TYPE_INT:
		result["read_error"] = "Invalid timestamp count/frame token"
		return
	result["timestamp_count"] = count
	result["reported_frame_token"] = token
	for i in mini(count, max_markers):
		var name = rd.call("get_captured_timestamp_name", i)
		var cpu = rd.call("get_captured_timestamp_cpu_time", i)
		var gpu = rd.call("get_captured_timestamp_gpu_time", i)
		if typeof(name) != TYPE_STRING or typeof(cpu) != TYPE_INT or typeof(gpu) != TYPE_INT:
			result["read_error"] = "Invalid timestamp value at index " + str(i)
			return
		result.markers.append([name, cpu, gpu])
	# Nonessential metadata is last, always guarded, and cannot block timestamp collection.
	result["unsupported_metadata"] = []
	for key in OPTIONAL_RD:
		var method: String = OPTIONAL_RD[key]
		if rd.has_method(method):
			result[key] = rd.call(method)
		else:
			result.unsupported_metadata.append(method)

func _store(result: Dictionary) -> void:
	if samples.size() < max_samples:
		samples.append(result)
	else:
		counts.samples_dropped += 1

func _accept(generation: int, serial: int, result: Dictionary) -> void:
	if generation != _generation or not _active or serial != _serial:
		counts.stale_deliveries += 1
		return
	# Clear pending before any optional result parsing.
	_pending = false
	if result.has("read_error"):
		counts.read_errors += 1
		_store(result)
		return
	if result.get("rd_absent", false):
		counts.rd_absent += 1
		_store(result)
		return
	var markers: Array = result.get("markers", [])
	var key := str(result.get("reported_frame_token")) + ":" + str(markers.front() if not markers.is_empty() else [])
	if key == _last_key:
		counts.duplicate_results += 1
		return
	_last_key = key
	counts.markers_dropped += maxi(0, int(result.get("timestamp_count", 0)) - max_markers)
	_store(result)

func stop() -> Dictionary:
	_active = false
	_generation += 1
	if RenderingServer.frame_pre_draw.is_connected(_pre):
		RenderingServer.frame_pre_draw.disconnect(_pre)
	if RenderingServer.frame_post_draw.is_connected(_post):
		RenderingServer.frame_post_draw.disconnect(_post)
	var report := {"schema": "godot-native-render-observer-v2", "metadata": _metadata,
		"counts": counts, "samples": samples, "boundaries": boundaries,
		"diagnostic_only": true, "gpu_validated": false, "physical_present_observed": false,
		"units": {"cpu": "microseconds", "gpu": "nanoseconds"}, "pending_read_at_stop": _pending}
	if not output_path.is_empty():
		var file := FileAccess.open(output_path, FileAccess.WRITE)
		if file == null:
			push_error("Cannot create observer report: " + output_path)
			report["write_error"] = FileAccess.get_open_error()
		else:
			file.store_string(JSON.stringify(report) + "\n")
	return report

func _exit_tree() -> void:
	if _active:
		stop()
