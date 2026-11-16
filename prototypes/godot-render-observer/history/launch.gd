extends SceneTree
# Root-only visible diagnostic launcher. Requires an existing, unchanged scene.
# --script absolute/launch.gd -- --observe-scene=res://main.tscn --observe-output=ABS.json
var observer: Node

func _initialize() -> void:
	var scene_path := ""
	var output := ""
	var limit := 240
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--observe-scene="):
			scene_path = arg.trim_prefix("--observe-scene=")
		elif arg.begins_with("--observe-output="):
			output = arg.trim_prefix("--observe-output=")
		elif arg.begins_with("--observe-limit="):
			limit = int(arg.trim_prefix("--observe-limit="))
	assert(not scene_path.is_empty() and not output.is_empty())
	assert("--gpu-profile" in OS.get_cmdline_args(), "Engine markers require --gpu-profile")
	var observer_script = load(get_script().resource_path.get_base_dir().path_join("observer.gd"))
	observer = observer_script.new()
	root.add_child(observer)
	observer.start(output, limit)
	# Starts at boot, so use enough bounded capacity or start manually at scenario START.
	var packed = load(scene_path)
	assert(packed is PackedScene)
	var scene: Node = packed.instantiate()
	root.add_child(scene)
	current_scene = scene
