extends Node
# Headless launcher control-flow fixture only; never GPU/performance evidence.
func _ready() -> void:
	get_tree().quit.call_deferred(0)
