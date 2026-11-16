extends SceneTree
const Gate=preload("res://warmup_gate.gd")
func _init() -> void:
	var gate=Gate.new()
	var counts: PackedInt64Array=PackedInt64Array([0,10,20,0,0])
	gate.start("visible-original-assets",counts)
	for i in range(20): assert(not gate.observe(i*16.0,16.0,counts,0,0))
	gate.start("visible-original-assets",counts)
	for i in range(10): assert(not gate.observe(i*16.0,16.0,counts,10,10))
	counts[3]+=1
	assert(not gate.observe(200,1517,counts,10,10))
	for i in range(11): assert(not gate.observe(220+i*16.0,16.0,counts,10,10))
	assert(gate.observe(420,16,counts,10,10))
	gate.start("restored",counts)
	for i in range(15): assert(not gate.observe(i*16.0,16.0,counts,10,10))
	assert(gate.observe(260,16,counts,10,10))
	counts[0]-=1
	assert(not gate.observe(280,16,counts,10,10) and not gate.error.is_empty())
	print("PASS pure warmup gate: no-draw reject, late compilation and1517ms stall reset, restored draw gate, monotonic counter failure; noGPU claim")
	quit(0)
