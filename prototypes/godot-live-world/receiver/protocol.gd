extends RefCounted
class_name GHLP
const HEADER: int = 48
const MAGIC: int = 0x504c4847
const VERSION: int = 1
const MAX_PACKET: int = 131072
const HELLO: int = 1
const POSE: int = 2
const START: int = 3
const ACK: int = 4
const PING: int = 5
const CLOCK: int = 6
const DONE: int = 7

static func control(kind: int, seq: int = 0, tick: int = 0, mono_ms: float = 0.0) -> PackedByteArray:
	var bytes: PackedByteArray = PackedByteArray()
	bytes.resize(HEADER)
	bytes.encode_u32(0,HEADER-4)
	bytes.encode_u32(4,MAGIC)
	bytes.encode_u16(8,VERSION)
	bytes.encode_u16(10,kind)
	bytes.encode_u32(12,seq)
	bytes.encode_u32(16,tick)
	bytes.encode_double(24,mono_ms)
	bytes.encode_double(32,Time.get_unix_time_from_system()*1000.0)
	return bytes

static func decode(bytes: PackedByteArray) -> Dictionary:
	if bytes.size()<HEADER or bytes.size()>MAX_PACKET: return {"error":"packet size outside bounds"}
	if bytes.decode_u32(0)+4!=bytes.size() or bytes.decode_u32(4)!=MAGIC or bytes.decode_u16(8)!=VERSION:
		return {"error":"invalid framing magic/version/size"}
	var h: Dictionary = {"kind":bytes.decode_u16(10),"seq":bytes.decode_u32(12),"tick":bytes.decode_u32(16),
		"monoMs":bytes.decode_double(24),"epochMs":bytes.decode_double(32),"simSeconds":bytes.decode_double(40)}
	for key in ["monoMs","epochMs","simSeconds"]:
		if not is_finite(float(h[key])): return {"error":"nonfinite header clock"}
	var body: PackedByteArray = bytes.slice(HEADER)
	if h.kind in [HELLO,DONE]:
		var value: Variant = JSON.parse_string(body.get_string_from_utf8())
		if not value is Dictionary: return {"error":"invalid JSON control"}
		h.payload=value
	elif h.kind==CLOCK:
		if body.size()!=24: return {"error":"invalid CLOCK size"}
		h.payload={"clientSend":body.decode_double(0),"nodeReceive":body.decode_double(8),"nodeSend":body.decode_double(16)}
	elif h.kind==POSE:
		var decoded: Dictionary = _pose(body)
		if decoded.has("error"): return decoded
		h.payload=decoded
	else: return {"error":"unexpected source packet kind"}
	return h

static func _pose(bytes: PackedByteArray) -> Dictionary:
	if bytes.size()<160: return {"error":"short pose preamble"}
	var skins: int=bytes.decode_u32(0)
	var bodies: int=bytes.decode_u32(4)
	var units: int=bytes.decode_u32(8)
	if skins>64 or bodies>2048 or units>64: return {"error":"pose count cap"}
	var out: Dictionary={"skins":[],"bodies":[],"k9":[],"superseded":bytes.decode_u32(12),
		"cameraWorld":_floats(bytes,16,16),"cameraProjection":_floats(bytes,80,16),
		"camera":{"fov":bytes.decode_float(144),"aspect":bytes.decode_float(148),"near":bytes.decode_float(152),"far":bytes.decode_float(156)}}
	var offset: int=160
	var ids: Dictionary={}
	for i in range(skins):
		if offset+88>bytes.size(): return {"error":"short skin record"}
		var bone_count: int=bytes.decode_u32(offset+20)
		if bone_count!=34 or offset+88+bone_count*64>bytes.size(): return {"error":"unproved bone count or short palette"}
		var id: int=bytes.decode_u32(offset)
		if ids.has(id): return {"error":"duplicate skin ID"}
		ids[id]=true
		out.skins.append({"id":id,"flags":bytes.decode_u32(offset+4),"actor":bytes.decode_u32(offset+8),
			"rigIndex":bytes.decode_u32(offset+12),"team":bytes.decode_u32(offset+16),"bones":bone_count,
			"root":_floats(bytes,offset+24,16),"palette":_floats(bytes,offset+88,bone_count*16)})
		offset+=88+bone_count*64
	if offset+bodies*80+units*32!=bytes.size(): return {"error":"body/K9/trailing byte size mismatch"}
	ids.clear()
	for i in range(bodies):
		var id: int=bytes.decode_u32(offset)
		if ids.has(id): return {"error":"duplicate body ID"}
		ids[id]=true
		out.bodies.append({"id":id,"model":bytes.decode_u32(offset+4),"flags":bytes.decode_u32(offset+8),
			"sourcePropIndex":bytes.decode_u32(offset+12),"matrix":_floats(bytes,offset+16,16)})
		offset+=80
	ids.clear()
	for i in range(units):
		var id: int=bytes.decode_u32(offset)
		if ids.has(id): return {"error":"duplicate K9 ID"}
		ids[id]=true
		out.k9.append({"id":id,"team":bytes.decode_u32(offset+4),"alive":bytes.decode_u32(offset+8),
			"phase":bytes.decode_u32(offset+12),"positionYaw":_floats(bytes,offset+16,4)})
		offset+=32
	# Every float field is inspected; NaN must not enter a native palette or camera.
	var values: Array=[out.cameraWorld,out.cameraProjection]
	for skin in out.skins: values.append(skin.root);values.append(skin.palette)
	for item in out.bodies: values.append(item.matrix)
	for item in out.k9: values.append(item.positionYaw)
	for array in values:
		for value in array:
			if not is_finite(float(value)): return {"error":"nonfinite native transform"}
	for value in out.camera.values():
		if not is_finite(float(value)): return {"error":"nonfinite camera setting"}
	return out

static func _floats(bytes: PackedByteArray,offset: int,count: int) -> PackedFloat32Array:
	return bytes.slice(offset,offset+count*4).to_float32_array()
