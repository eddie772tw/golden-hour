extends RefCounted
# Completion counters are cumulative, not a pending-job API. This is an observed
# draw/quiescence gate with bounded failure, never proof of all future pipelines.
var phase: String=""
var frames: int=0
var quiet: int=0
var previous: PackedInt64Array=PackedInt64Array()
var intervals: Array=[]
var rows: Array=[]
var error: String=""
var saw_draw: bool=false
const QUIET_FRAMES: int=12
const MIN_FRAMES: int=16

func start(next_phase: String,counts: PackedInt64Array) -> void:
	phase=next_phase
	frames=0
	quiet=0
	previous=counts.duplicate()
	intervals.clear()
	saw_draw=false

func observe(now: float,dt: float,counts: PackedInt64Array,objects: int,draws: int) -> bool:
	frames+=1
	var delta: PackedInt64Array=PackedInt64Array()
	var changed: bool=false
	for i in range(counts.size()):
		var difference: int=counts[i]-previous[i]
		if difference<0: error="Cumulative pipeline counter decreased";return false
		delta.append(difference)
		changed=changed or difference!=0
	previous=counts.duplicate()
	quiet=0 if changed else quiet+1
	saw_draw=saw_draw or (objects>0 and draws>0)
	if dt>0:
		intervals.append(dt)
		if intervals.size()>QUIET_FRAMES: intervals.pop_front()
	if rows.size()<2000: rows.append([now,dt,phase,Array(counts),Array(delta),objects,draws])
	if frames<MIN_FRAMES or quiet<QUIET_FRAMES or intervals.size()<QUIET_FRAMES or not saw_draw: return false
	var ordered: Array=intervals.duplicate()
	ordered.sort()
	var median: float=float(ordered[ordered.size()/2])
	# Stability excludes lingering one-off cold stalls without pretending that a
	# stable slow scene meets60FPS. All cold rows and elapsed costs stay in report.
	return float(ordered.back())<=maxf(50.0,median*2.0)
