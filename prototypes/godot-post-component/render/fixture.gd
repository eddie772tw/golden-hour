extends RefCounted
const PROOF_SHA: String="1aa0aab81b3ec8458aaf4d549d917e327e9f3937445b6b469d3daab081de8a54"
const CASES_SHA: String="6db440ac7224472c9a5dc6bc8780d66d161b2e5f25c76bf11711ce63fa9a5543"
var proof: Dictionary={}
var cases: Dictionary={}
var shader_code: String=""

func sha(bytes: PackedByteArray) -> String:
	var hash: HashingContext=HashingContext.new()
	hash.start(HashingContext.HASH_SHA256)
	hash.update(bytes)
	return hash.finish().hex_encode()

func load_source() -> bool:
	var bytes: PackedByteArray=FileAccess.get_file_as_bytes("res://fixtures/source-post-proof.json")
	if bytes.size()>32768 or sha(bytes)!=PROOF_SHA: return false
	proof=JSON.parse_string(bytes.get_string_from_utf8())
	if proof.sourceCaptureSHA256!="fe313438559e03f43396111dc59e4f7e9702593dc78aa975ff1d4020c10cd9bb" or proof.currentCompiledFinal.id!=123 or proof.currentCompiledFinal.fragmentSHA256!="010b92601d5dffe17c397cab6d2dce30b51667fcf376b1775ef4d560d0a6209b": return false
	if float(proof.sourceRead.nativeDecoded.exposure)!=0.90869140625: return false
	var include: String=FileAccess.get_file_as_string("res://post_film.gdshaderinc")
	if sha(include.to_utf8_buffer())!=proof.nativeIncludeSHA256: return false
	var case_bytes: PackedByteArray=FileAccess.get_file_as_bytes("res://fixtures/post-cases.json")
	if case_bytes.size()>32768 or sha(case_bytes)!=CASES_SHA: return false
	cases=JSON.parse_string(case_bytes.get_string_from_utf8())
	if cases.sourceCaptureSHA256!=proof.sourceCaptureSHA256 or cases.sourceFinalFragmentSHA256!=proof.sourceFinalFragmentSHA256 or float(cases.fixedExposure)!=float(proof.sourceRead.nativeDecoded.exposure): return false
	shader_code="shader_type spatial;render_mode unshaded;\n"+include+"\nuniform vec3 hdr_input;uniform vec3 reference_linear;uniform bool reference_mode;\nvoid fragment(){ALBEDO=reference_mode?reference_linear:sourceExposureFilm(hdr_input);}\n"
	return true

func bind(material: ShaderMaterial,row: Dictionary,reference_mode: bool=false) -> void:
	var u: Dictionary=proof.actualUniforms
	for key in ["uExposure","uSuppress","uHurt"]: material.set_shader_parameter(key,float(u[key]))
	material.set_shader_parameter("fixedExposure",float(proof.sourceRead.nativeDecoded.exposure))
	material.set_shader_parameter("uAuto",float(row.auto))
	material.set_shader_parameter("uHueKeep",float(row.hueKeep))
	material.set_shader_parameter("hdr_input",Vector3(row.input[0],row.input[1],row.input[2]))
	material.set_shader_parameter("reference_linear",Vector3(row.expectedLinear[0],row.expectedLinear[1],row.expectedLinear[2]))
	material.set_shader_parameter("reference_mode",reference_mode)
