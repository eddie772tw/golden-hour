extends SceneTree
# --gpu-profile is consumed by the engine; OS argument arrays are not proof.
# Root launch manifest + actual captured markers establish profiling coverage.
var observer: Node
var startup_output := ""
var startup := {"schema": "godot-render-observer-startup-v3", "ok": false,
	"gpu_validated": false, "gpu_profile_flag_verified": false,
	"verification_required": "external launch manifest and actual captured markers"}

func _initialize() -> void:
	_start.call_deferred()

func _fail(message: String) -> void:
	startup["error"] = message
	_write_startup()
	push_error("Observer launcher v3 startup failed: " + message)
	quit(2)

func _write_startup() -> void:
	if not startup_output.is_empty() and not FileAccess.file_exists(startup_output):
		var file := FileAccess.open(startup_output, FileAccess.WRITE)
		if file != null:
			file.store_string(JSON.stringify(startup) + "\n")

func _start() -> void:
	var scene_path := ""
	var output := ""
	var limit_text := "240"
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--observe-scene="):
			scene_path = arg.trim_prefix("--observe-scene=")
		elif arg.begins_with("--observe-output="):
			output = arg.trim_prefix("--observe-output=")
		elif arg.begins_with("--observe-limit="):
			limit_text = arg.trim_prefix("--observe-limit=")
	if scene_path.is_empty() or output.is_empty():
		_fail("--observe-scene and --observe-output are required")
		return
	if not limit_text.is_valid_int() or int(limit_text) < 1 or int(limit_text) > 20000:
		_fail("--observe-limit must be an integer in 1..20000")
		return
	if FileAccess.file_exists(output) or FileAccess.file_exists(output + ".startup.json"):
		_fail("Refusing to overwrite observer or startup evidence")
		return
	startup_output = output + ".startup.json"
	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(output).get_base_dir()):
		_fail("Observer output directory must already exist")
		return
	# Test writability before starting a scene; never leave an empty scene running.
	var output_test := FileAccess.open(output, FileAccess.WRITE)
	if output_test == null:
		_fail("Observer output path is not writable")
		return
	output_test.close()
	if DirAccess.remove_absolute(ProjectSettings.globalize_path(output)) != OK:
		_fail("Could not release observer output writability probe")
		return
	if not Engine.get_version_info().get("hash", "").begins_with("ed1daf0bf"):
		_fail("Recheck observer API/source for another engine version")
		return
	if not ResourceLoader.exists(scene_path, "PackedScene"):
		_fail("Scene does not exist or is not a PackedScene: " + scene_path)
		return
	var packed = load(scene_path)
	if not packed is PackedScene:
		_fail("Scene failed to load as PackedScene: " + scene_path)
		return
	var observer_script = load(get_script().resource_path.get_base_dir().path_join("observer-v2.gd"))
	if not observer_script is Script or not observer_script.can_instantiate():
		_fail("Observer script failed to load")
		return
	var scene: Node = packed.instantiate()
	if scene == null:
		_fail("Scene failed to instantiate")
		return
	observer = observer_script.new()
	if not observer is Node or not observer.has_method("start"):
		scene.free()
		_fail("Observer is not a Node with start()")
		return
	root.add_child(observer)
	if not observer.start(output, int(limit_text)):
		scene.free()
		_fail("Observer start rejected: " + str(observer.start_error))
		return
	root.add_child(scene)
	current_scene = scene
	startup.merge({"ok": true, "scene": scene_path, "observer_output": output,
		"sample_limit": int(limit_text), "engine": Engine.get_version_info(),
		"scene_added": is_instance_valid(scene) and scene.is_inside_tree()}, true)
	_write_startup()
	print("Observer launcher v3 scene added; GPU coverage requires raw marker review")
