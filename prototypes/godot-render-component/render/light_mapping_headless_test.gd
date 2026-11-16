extends SceneTree
# Actual native Light3D objects, no snapshot, rendering, GPU or pixel assertion.
const Component = preload("res://main.gd")
var failures: int=0
var checks: int=0
func check(ok: bool,label: String) -> void:
	checks+=1
	print("GH_LIGHT_MAPPING_CHECK "+JSON.stringify({"ok":ok,"label":label}))
	if not ok: failures+=1
func _init() -> void:
	var source: Dictionary={"id":"source","type":"PointLight","matrix":[1,0,0,0,0,1,0,0,0,0,1,0,0,2,0,1],"color":[.8,.3,.08],"intensity":17,"layers":1,"castShadow":false,"visible":true,"distance":19,"decay":2,"target":null,"angle":.5}
	for kind in ["PointLight","DirectionalLight","SpotLight"]:
		for color_mode in ["native","source-linear"]:
			for energy_mode in ["native","source-irradiance"]:
				for decay in [false,true]:
					var c=Component.new()
					c.light_color_mode=color_mode
					c.direct_energy=energy_mode
					c.source_decay=decay
					source.type=kind
					c._import_light(source)
					var light: Light3D=c.get_child(0)
					var expected_color: Color=Color(.8,.3,.08).linear_to_srgb() if color_mode=="source-linear" else Color(.8,.3,.08)
					var expected_energy: float=17.0/PI if energy_mode=="source-irradiance" else 17.0
					var ok: bool=light.light_color==expected_color and absf(light.light_energy-expected_energy)<1e-6
					ok=ok and light.light_cull_mask==1 and not light.shadow_enabled and light.visible and c.emission_scale==1.0 and c.light_energy_scale==1.0 and c.tonemap_mode=="linear"
					if light is OmniLight3D: ok=ok and light.omni_range==19.0 and light.omni_attenuation==(2.0 if decay else 1.0)
					if light is SpotLight3D: ok=ok and light.spot_range==19.0 and absf(light.spot_angle-rad_to_deg(.5))<1e-5
					ok=ok and c.energy_mapping.size()==1 and c.light_color_mapping.size()==1
					check(ok,kind+"/"+color_mode+"/"+energy_mode+"/decay="+str(decay))
					c.free()
	var c=Component.new()
	c.source_decay=true
	source.type="PointLight"
	source.decay=-1
	c._import_light(source)
	check(c.get_child(0).omni_attenuation==1.0 and not c.light_mapping[0].mapped and c.limitations.size()==1,"Invalid point exponent preserves native fallback with explicit limitation")
	c.free()
	print("GH_LIGHT_MAPPING_RESULT "+JSON.stringify({"checks":checks,"failures":failures,"GPU":false}))
	quit(0 if failures==0 else 2)
