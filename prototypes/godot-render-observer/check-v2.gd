extends SceneTree

class FakeRD extends RefCounted:
	func get_captured_timestamps_count(): return 2
	func get_captured_timestamps_frame(): return 7
	func get_captured_timestamp_name(i): return ["Frame Begin", "Render Opaque Pass"][i]
	func get_captured_timestamp_cpu_time(i): return 100 + 5 * i
	func get_captured_timestamp_gpu_time(i): return 100000 + 1000 * i
	func get_device_name(): return "UNIT_FAKE_NOT_GPU"

class InvalidRD extends FakeRD:
	func get_captured_timestamp_cpu_time(_i): return null

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var script = load("res://observer-v2.gd")
	var observer = script.new()
	root.add_child(observer)
	assert(observer.start("", 8))
	var contract: Dictionary = observer.api_contract()
	assert(contract.missing.is_empty())
	assert(not ClassDB.class_has_method("RenderingDevice", "get_device_api_name"))
	assert(not ClassDB.class_has_method("RenderingDevice", "get_device_api_version"))
	for signal_name in ["frame_pre_draw", "frame_post_draw"]:
		assert(ClassDB.class_has_signal("RenderingServer", signal_name))
	# Real installed Dummy boundary: absence is explicit, never a GPU zero sample.
	observer._serial = 1
	observer._pending = true
	observer._read(observer._generation, 1, Time.get_ticks_usec(), 0)
	await process_frame
	assert(not observer._pending and observer.counts.rd_absent == 1)
	# Exercise actual collector with bounded fake objects, clearly unit-only.
	var sample := {"markers": []}
	observer._collect(FakeRD.new(), sample)
	assert(sample.markers.size() == 2)
	assert(sample.unsupported_metadata.has("get_device_api_version"))
	observer._pending = true
	observer._accept(observer._generation, 1, sample)
	assert(not observer._pending and observer.samples.size() == 2)
	var unsupported := {"markers": []}
	observer._collect(RefCounted.new(), unsupported)
	assert(unsupported.has("read_error"))
	observer._pending = true
	observer._accept(observer._generation, 1, unsupported)
	assert(not observer._pending and observer.counts.read_errors == 1)
	var invalid := {"markers": []}
	observer._collect(InvalidRD.new(), invalid)
	assert(invalid.has("read_error"))
	observer._pending = true
	observer._accept(observer._generation, 1, invalid)
	assert(not observer._pending and observer.counts.read_errors == 2)
	# Simulate a callback abort: next existing post signal recovers, no extra timer.
	observer._pending = true
	observer._pending_since_us = -300000
	observer._post()
	await process_frame
	assert(observer.counts.pending_timeouts == 1)
	assert(not observer._pending)
	var report: Dictionary = observer.stop()
	assert(not RenderingServer.frame_post_draw.is_connected(observer._post))
	assert(not RenderingServer.frame_pre_draw.is_connected(observer._pre))
	var before: int = observer.samples.size()
	observer._accept(observer._generation - 1, observer._serial, {"rd_absent": true})
	assert(observer.samples.size() == before)
	var result := {"schema": "godot-observer-v2-headless-check", "engine": Engine.get_version_info(),
		"api_contract": contract, "gpu_measured": false, "unit_fake_markers_only": true,
		"dummy_boundary": true, "missing_required_and_bad_value_pending_recovery": true,
		"missing_optional_metadata_not_blocking": true, "aborted_callback_timeout_recovery": true,
		"stop_disconnect_generation": true, "report": report}
	var file := FileAccess.open("res://headless-check-v2.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(result, "\t") + "\n")
	print("Observer v2 full API/collector/recovery checks PASS; Dummy and unit fake only; GPU not measured")
	quit()
