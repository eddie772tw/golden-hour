extends AudioStreamPlayer
# Attach to the existing scene. The existing Node receiver owns transport/timestamps.
var native_playback

func open_bank(asset_dir):
    if not is_inside_tree() or playing or load("res://audio.gdextension")==null:
        return false
    var factory=ClassDB.instantiate("GHProofStream")
    var noise=[]
    for file in ["white.f32","brown.f32"]:
        var data=FileAccess.get_file_as_bytes(asset_dir.path_join(file)).to_float32_array()
        if data.is_empty():return false
        noise.append(data)
    factory.set_assets(noise[0],noise[1])
    var manifest=JSON.parse_string(FileAccess.get_file_as_string(asset_dir.path_join("buffers.json")))
    if typeof(manifest)!=TYPE_DICTIONARY:return false
    for key in manifest:
        var entry=manifest[key]
        var planes=[]
        if entry.files.size()!=int(entry.channels) or entry.files.size() not in [1,2]:return false
        for i in range(entry.files.size()):
            var filename=asset_dir.path_join(entry.files[i])
            if FileAccess.get_sha256(filename)!=entry.sha256[i]:return false
            var plane=FileAccess.get_file_as_bytes(filename).to_float32_array()
            if plane.size()!=int(entry.frames):return false
            planes.append(plane)
        var right=planes[1] if planes.size()==2 else PackedFloat32Array()
        if not factory.register_asset(int(key),int(entry.sampleRate),planes[0],right):return false
    stream=factory
    play()
    native_playback=get_stream_playback()
    return native_playback!=null

func submit_record(record):
    return native_playback!=null and native_playback.submit_record(record)

func sample_clock():
    return native_playback.sample_clock() if native_playback!=null else -1

func receipt():
    return native_playback.receipt() if native_playback!=null else []

func close_bank():
    stop()
    stream=null
    native_playback=null
