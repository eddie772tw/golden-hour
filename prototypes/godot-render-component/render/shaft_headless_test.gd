extends SceneTree
const Port = preload("res://source_shaders.gd")
var failed: int=0
func check(value: bool, label: String) -> void:
	print("GH_SHAFT_CHECK "+JSON.stringify({"label":label,"ok":value}))
	if not value: failed+=1

func _init() -> void:
	var fixture: Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://fixtures/shaft-capture3-fixture.json"))
	var snapshot: Dictionary={"source":fixture.source,"objects":[fixture.owner],"materials":{fixture.material.id:fixture.material},"geometries":{fixture.geometry.id:fixture.geometry}}
	var audit_path: String=ProjectSettings.globalize_path("res://fixtures/gl-audit-proof.json")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--audit="): audit_path=arg.substr(8)
	var port=Port.new()
	var ok: bool=port.prepare(audit_path,snapshot)
	print("GH_SHAFT_HEADLESS "+JSON.stringify({"ok":ok,"report":port.report,"array_numeric_equality":fixture.owner.matrix==[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}))
	check(ok and port.report.ports.size()==1,"real JSON float matrix passes exact numeric identity")
	var changed: Dictionary=snapshot.duplicate(true)
	changed.objects[0].matrix[12]=1e-15
	var bad_owner=Port.new()
	check(not bad_owner.prepare(audit_path,changed) and not bad_owner.report.unmatched.is_empty(),"nonzero translation rejects with reason; no epsilon")
	changed=snapshot.duplicate(true)
	changed.source.quality="medium"
	var bad_quality=Port.new()
	check(not bad_quality.prepare(audit_path,changed) and not bad_quality.report.unmatched.is_empty(),"non-High rejects with reason")
	changed=snapshot.duplicate(true)
	changed.materials[fixture.material.id].depthWrite=true
	var bad_flags=Port.new()
	check(not bad_flags.prepare(audit_path,changed) and not bad_flags.report.unmatched.is_empty(),"changed depthWrite rejects with reason")
	changed=snapshot.duplicate(true)
	var renamed: String="different-session-material-id"
	changed.materials[renamed]=changed.materials[fixture.material.id]
	changed.materials.erase(fixture.material.id)
	changed.materials[renamed].id=renamed
	changed.objects[0].materials=[renamed]
	changed.objects[0].surfaces[0].material=renamed
	changed.objects[0].id="different-session-owner-id"
	var new_ids=Port.new()
	check(new_ids.prepare(audit_path,changed),"UUID changes do not affect guarded semantic relation")
	print("GH_SHAFT_HEADLESS_RESULT "+JSON.stringify({"checks":5,"failures":failed,"GPU":false}))
	quit(0 if failed==0 else 2)
