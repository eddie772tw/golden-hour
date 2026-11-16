extends SceneTree
const Fixture=preload("res://fixture.gd")
func _init() -> void:
	var source=Fixture.new()
	if not source.load_source(): quit(2);return
	var shader: Shader=Shader.new()
	shader.code=source.shader_code
	var names: Array=[]
	for item in shader.get_shader_uniform_list(): names.append(item.name)
	for name in ["uExposure","uAuto","uHueKeep","fixedExposure","hdr_input","reference_linear","reference_mode"]:
		if not name in names: quit(2);return
	var material: ShaderMaterial=ShaderMaterial.new()
	material.shader=shader
	source.bind(material,source.cases.cases[2])
	if float(material.get_shader_parameter("fixedExposure"))!=0.90869140625: quit(2);return
	if float(material.get_shader_parameter("uAuto"))!=1.0: quit(2);return
	if source.shader_code.contains("TIME") or source.shader_code.contains("toSRGB"): quit(2);return
	print("GH_POST_FILM_CPU "+JSON.stringify({"ok":true,"GPU":false,"proof":source.PROOF_SHA,"cases":source.cases.cases.size(),"uniformNames":names}))
	quit(0)
