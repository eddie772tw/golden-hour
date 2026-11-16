extends Node3D
class_name GHOptionalWorldScaffold
const Importer=preload("res://capture_importer.gd")
const Ownership=preload("res://ownership.gd")
var importer: GHSourceCaptureImporter
var source: Dictionary={}
var inventory: Array=[]
var category_counts: Dictionary={}
var geometry_hashes: Dictionary={}
var report: Dictionary={}

# Explicit root-owned cold operation: this can parse the 825MB source. Never call in a clean window.
func load_capture(path: String,hello: Dictionary,props: GHOriginalPropLibrary=null,material_factory: Callable=Callable(),backend_options: Dictionary={}) -> void:
	assert(importer==null)
	var start: int=Time.get_ticks_usec()
	var file: FileAccess=FileAccess.open(path,FileAccess.READ)
	assert(file!=null,"Real original capture required")
	var value: Variant=JSON.parse_string(file.get_as_text())
	assert(value is Dictionary and value.get("schema","")=="gh-godot-render-snapshot-v1")
	assert(value.source.get("capturedFrom","")=="GH.debug.gfx.scene")
	assert(str(value.source.coreSHA256)==str(hello.coreSHA256))
	source=value.source
	var actors: Dictionary=Ownership.replacement_actors(hello)
	importer=Importer.new()
	add_child(importer)
	importer.backend_options=backend_options
	if not importer.prepare(value,material_factory): return
	var prop_by_index: Dictionary={}
	if props!=null:
		assert(props.bound)
		for prop in props.packet.props: prop_by_index[int(prop.sourcePropIndex)]=prop
	for item in value.objects:
		var decision: Dictionary=Ownership.classify(item,actors)
		var geometry: Dictionary=value.geometries[item.geometry]
		if decision.kind=="candidate-initial-prop":
			decision=_prop_decision(item,geometry,decision,props,prop_by_index)
		var count: Dictionary=_counts(item,geometry)
		var key: String=str(decision.kind)
		if not category_counts.has(key): category_counts[key]={"objects":0,"vertexReferences":0,"instances":0,"surfaceIndexReferences":0}
		for metric in count: category_counts[key][metric]+=count[metric]
		inventory.append({"sourceID":item.id,"nativeID":item.nativeID,"name":item.name,"path":item.path,
			"owners":item.get("owners",[]),"geometry":item.geometry,"materials":item.materials,
			"sourceVisible":item.visible,"sourceSkinMarked":item.get("skin") is Dictionary,"decision":decision,"counts":count})
		if key=="static-or-unowned-source": importer._import_object(item)
		elif key=="replaced-prop-rest-mapped": props.bind_capture_child(item,decision,importer)
	if props!=null: props.finish_capture_binding()
	# Original lights remain captured/static. Camera stays exclusively owned by the live receiver.
	for light in value.lights: importer._import_light(light)
	report={"schema":"gh-optional-world-scaffold-v1","sourcePath":path,"sourceSHA256":FileAccess.get_sha256(path),"source":source,"sourceCounts":value.counts,
		"sourceParity":value.parity,"sourceUnsupported":value.unsupported,"categoryCounts":category_counts,"inventory":inventory,
		"importCounts":importer.import_counts,"materialDiagnostics":importer.mapping_diagnostics,
		"originalImporterSHA256":importer.original_importer_sha256,"coldLoadMs":(Time.get_ticks_usec()-start)/1000.0,
		"textureManifest":str(backend_options.get("textures","")),"textureBinding":importer.texture_binding.report,
		"pbrAdaptor":importer.pbr_adaptor.report if importer.material_mode=="pbr-adaptor" else null,"sourceShaderPorts":importer.source_shaders.report,
		"propCaptureMaterials":props.capture_materials if props!=null else null,
		"propRestBound":props!=null and props.bound,"fullSceneParity":false,"highParity":false,"additionalBatching":false,
		"limits":["Only exact source-marked skins with verified HELLO bot owner have live-skin replacement classification.",
			"No static/unowned object is excluded by name; actor/physics/K9 ownership is the exclusion authority.",
			"Unmapped dynamic capture records stay in this inventory but are not drawn as stale tick240 objects.",
			"Initial prop capture replacement additionally requires index/path/root-name and original geometry fingerprints.",
			"Node rest templates are distinct original assets; no captured child matrix is treated as a missing Group root.",
			"Textures/custom GLSL/aux semantics/FX/FP/weapon/K9 child animation and dynamic temporary assets remain explicit gaps.",
			"Captured lights/static-unowned geometry are a scaffold, not an accepted full live scene or original High image."]}

func _prop_decision(item: Dictionary,g: Dictionary,candidate: Dictionary,props: GHOriginalPropLibrary,by_index: Dictionary) -> Dictionary:
	var index: int=int(candidate.sourcePropIndex)
	if props==null or not by_index.has(index):
		return {"kind":"excluded-unmapped-dynamic","reason":"initial prop needs original Node rest asset","owner":candidate.owner}
	var prop: Dictionary=by_index[index]
	var found: Dictionary={}
	for child in prop.children:
		if str(child.path)==str(candidate.owner.path):
			if not found.is_empty(): return {"kind":"excluded-unmapped-dynamic","reason":"ambiguous original prop child path","owner":candidate.owner}
			found=child
	if found.is_empty(): return {"kind":"excluded-unmapped-dynamic","reason":"capture child path missing in true original template","owner":candidate.owner}
	var original_geometry: Dictionary=props.packet.geometries[int(found.geometry)]
	var check: Dictionary=Ownership.matches_prop_child(item,g,candidate.owner,prop,found,original_geometry.captureMatch)
	if not check.ok: return {"kind":"excluded-unmapped-dynamic","reason":check.reason,"owner":candidate.owner}
	var fingerprint: Dictionary=_capture_geometry_fingerprint(g)
	var expected: Dictionary=original_geometry.captureMatch
	if fingerprint.positionFloat32SHA256!=expected.positionFloat32SHA256 or fingerprint.indexUint32SHA256!=expected.indexUint32SHA256:
		return {"kind":"excluded-unmapped-dynamic","reason":"original geometry fingerprint mismatch","owner":candidate.owner,"observed":fingerprint,"expected":expected}
	return {"kind":"replaced-prop-rest-mapped","sourcePropIndex":index,"childPath":found.path,"owner":candidate.owner,
		"captureRootPath":check.captureRootPath,"proof":fingerprint,"initializerSHA256":props.packet.source.initializerSHA256}

func _capture_geometry_fingerprint(g: Dictionary) -> Dictionary:
	var id: String=str(g.id)
	if geometry_hashes.has(id): return geometry_hashes[id]
	var positions: PackedByteArray=PackedFloat32Array(g.position.values).to_byte_array()
	var indices: PackedInt32Array
	if g.index is Array: indices=PackedInt32Array(g.index)
	else:
		indices=PackedInt32Array()
		for i in range(int(g.position.count)): indices.append(i)
	var result: Dictionary={"positionFloat32SHA256":_hash(positions),"indexUint32SHA256":_hash(indices.to_byte_array()),
		"vertexCount":g.position.count,"indexCount":indices.size()}
	geometry_hashes[id]=result
	return result

func _counts(item: Dictionary,g: Dictionary) -> Dictionary:
	var instances: int=1
	if item.instances is Dictionary: instances=int(item.instances.count)
	elif g.get("nativeInstanceCount")!=null: instances=int(g.nativeInstanceCount)
	var index_refs: int=0
	for surface in item.surfaces: index_refs+=int(surface.count)
	return {"objects":1,"vertexReferences":int(g.position.count),"instances":instances,"surfaceIndexReferences":index_refs}

func _hash(bytes: PackedByteArray) -> String:
	var context: HashingContext=HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()
