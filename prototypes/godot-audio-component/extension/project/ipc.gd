extends SceneTree

var player
var playback
var port
var stall_ms = 0
var stall_after = 1
var stopping = false
var started_us = 0
var calibration_start

func _initialize():
    call_deferred("begin")

func begin():
    var args = OS.get_cmdline_user_args()
    if args.size() < 3 or AudioServer.get_driver_name() != args[2] or AudioServer.get_mix_rate() != 48000:
        push_error("Expected <port> <asset_dir> <active 48000 Hz driver> [stall_ms] [after_enqueued]")
        quit(2)
        return
    port = int(args[0])
    if args.size() > 3: stall_ms = int(args[3])
    if args.size() > 4: stall_after = int(args[4])
    player = preload("res://scene_audio.gd").new()
    root.add_child(player)
    if not player.open_bank(args[1]):
        push_error("Could not open immutable PCM bank")
        shutdown(2)
        return
    playback = player.native_playback
    calibration_start = calibrate()
    started_us = Time.get_ticks_usec()

func calibrate():
    var begin = Time.get_ticks_usec()
    var row = playback.device_calibration()
    row["godot_us_after"] = Time.get_ticks_usec()
    row["godot_us_before"] = begin
    return row

func save_trace():
    var file = OS.get_environment("GH_CASING_DEVICE_TRACE")
    if file.is_empty(): return true
    var trace = playback.device_trace()
    trace["calibration_start"] = calibration_start
    trace["calibration_end"] = calibrate()
    trace["driver"] = AudioServer.get_driver_name()
    trace["rate"] = AudioServer.get_mix_rate()
    trace["output_device"] = AudioServer.output_device
    trace["output_latency_seconds"] = AudioServer.get_output_latency()
    var issues = []
    if trace.callback_overflow or trace.onset_overflow or trace.cue_overflow:
        issues.append("trace capacity exceeded")
    if trace.cue_receipts.is_empty(): issues.append("no cue receipts")
    var observed = {}
    for row in trace.voices:
        if observed.has(row[0]): issues.append("duplicate voice ID " + str(row[0]))
        observed[row[0]] = row[1]
        var contained = false
        for cb in trace.callbacks:
            if row[1]>=cb[0] and row[1]<cb[0]+cb[1] and cb[2]<=row[4] and row[4]<=row[5] and row[5]<=cb[3]:
                contained = true
                break
        if not contained: issues.append("missing frame/wall bracket for " + str(row[0]))
    for cue in trace.cue_receipts:
        var seen = observed.has(cue[1])
        if cue[3]==0 and not seen: issues.append("unobservable onset for voice " + str(cue[1]))
        if cue[3]!=0 and seen: issues.append("rejected voice produced audio " + str(cue[1]))
    trace["issues"] = issues
    var f = FileAccess.open(file,FileAccess.WRITE)
    if f==null: return false
    f.store_string(JSON.stringify(trace,"",true,true))
    f.close()
    if not issues.is_empty(): push_error(str(issues))
    return issues.is_empty()


func snapshot():
    var ipc = playback.ipc_stats()
    return {"clock": playback.sample_clock(), "ipc": ipc, "cb": playback.callback_stats(),
        "us": Time.get_ticks_usec(), "nativeUs": ipc[6]}

func _process(_delta):
    if playback == null or stopping: return false
    var stats = playback.ipc_stats()
    if stats[0] == 0 and playback.sample_clock() > 0:
        if not playback.start_ipc(port): shutdown(2)
    elif stats[0] == 2 and stall_ms > 0 and stats[1] >= stall_after:
        print(JSON.stringify({"stallBefore":snapshot()}))
        OS.delay_msec(stall_ms)
        print(JSON.stringify({"stallAfter":snapshot()}))
        stall_ms = 0
    elif stats[0] == 3 or stats[0] < 0:
        var filename=OS.get_environment("GH_CASING_CAPTURE")
        if not filename.is_empty():
            var pcm=FileAccess.open(filename,FileAccess.WRITE)
            if pcm==null:
                shutdown(3)
                return false
            pcm.store_buffer(playback.capture_pcm())
            pcm.close()
        var trace_ok = save_trace()
        print(JSON.stringify({"ipcEnd":snapshot()}))
        shutdown(0 if stats[0] == 3 and trace_ok else 2)
    elif Time.get_ticks_usec() - started_us > 180000000:
        push_error("IPC timed out")
        shutdown(2)
    return false

func shutdown(code):
    stopping = true
    playback = null
    if player != null:
        player.close_bank()
        player.queue_free()
        player = null
    await create_timer(0.15).timeout
    quit(code)
