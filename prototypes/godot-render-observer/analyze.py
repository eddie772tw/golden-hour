"""Offline raw-marker review. No engine launch, dependencies, or raw mutation."""
import argparse
import bisect
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path


def stats(values):
    ordered = sorted(values)
    if not ordered:
        return {"n": 0, "mean": None, "p50": None, "p95": None, "max": None}
    def quantile(p):
        index = (len(ordered) - 1) * p
        lo, hi = math.floor(index), math.ceil(index)
        return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)
    return {"n": len(ordered), "mean": sum(ordered) / len(ordered),
            "p50": quantile(.5), "p95": quantile(.95), "max": ordered[-1]}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf8"))


def analyze(raw, run=None, component=None, component_frame_offset=None):
    samples = raw["samples"]
    pre = sorted((r for r in raw["boundaries"] if r[0] == "pre"), key=lambda r: r[1])
    post = {r[2]: r for r in raw["boundaries"] if r[0] == "post"}
    pre_times = [r[1] for r in pre]
    findings = {"cpu_nonmonotonic": [], "gpu_nonmonotonic": [], "unmatched_groups": [],
                "timestamp_count_mismatch": [], "unmapped_cpu_envelopes": [], "zero_gpu_envelopes": [],
                "reported_read_errors": [i for i, s in enumerate(samples) if s.get("read_error") or s.get("rd_absent")],
                "cross_frame_cpu_nonmonotonic": [], "cross_frame_gpu_nonmonotonic": []}
    by_frame, empty, mappings, tokens, marker_names = [], [], [], [], set()
    previous_end = None
    for sample_index, sample in enumerate(samples):
        markers = sample.get("markers", [])
        tokens.append(sample.get("reported_frame_token"))
        if sample.get("timestamp_count", 0) != len(markers):
            findings["timestamp_count_mismatch"].append(sample_index)
        if not markers:
            empty.append(sample_index)
            continue
        if previous_end:
            if markers[0][1] < previous_end[1]: findings["cross_frame_cpu_nonmonotonic"].append(sample_index)
            if markers[0][2] < previous_end[2]: findings["cross_frame_gpu_nonmonotonic"].append(sample_index)
        previous_end = markers[-1]
        for i in range(len(markers) - 1):
            if markers[i + 1][1] < markers[i][1]: findings["cpu_nonmonotonic"].append([sample_index, i])
            if markers[i + 1][2] < markers[i][2]: findings["gpu_nonmonotonic"].append([sample_index, i])
        if markers[-1][2] <= markers[0][2]: findings["zero_gpu_envelopes"].append(sample_index)
        p = bisect.bisect_right(pre_times, markers[0][1]) - 1
        source_draw = None
        if p >= 0 and pre[p][2] in post and markers[-1][1] <= post[pre[p][2]][1]:
            source_draw = pre[p][2]
        else:
            findings["unmapped_cpu_envelopes"].append(sample_index)
        mapping = {"sample_index": sample_index, "token": sample.get("reported_frame_token"),
                   "requested_draw_count": sample.get("requested_draw_count"), "source_draw_by_cpu_envelope": source_draw}
        if source_draw is not None:
            mapping["token_minus_source_draw"] = sample["reported_frame_token"] - source_draw
            mapping["requested_minus_source_draw"] = sample["requested_draw_count"] - source_draw
        mappings.append(mapping)
        segments, groups, stack = defaultdict(lambda: [0., 0., 0]), defaultdict(lambda: [0., 0.]), []
        for i, (name, cpu, gpu) in enumerate(markers):
            marker_names.add(name)
            if name.startswith("> "):
                stack.append((name[2:], cpu, gpu))
            elif name.startswith("< "):
                if not stack or stack[-1][0] != name[2:]:
                    findings["unmatched_groups"].append([sample_index, i, name])
                else:
                    group_name, start_cpu, start_gpu = stack.pop()
                    path = " / ".join([r[0] for r in stack] + [group_name])
                    groups[path][0] += (cpu - start_cpu) / 1000
                    groups[path][1] += (gpu - start_gpu) / 1e6
            if i + 1 < len(markers):
                # Every adjacent interval is disjoint. Structural intervals remain
                # explicit rather than being falsely added as inclusive totals.
                path = " / ".join([r[0] for r in stack] + [name])
                values = segments[path]
                values[0] += (markers[i + 1][1] - cpu) / 1000
                values[1] += (markers[i + 1][2] - gpu) / 1e6
                values[2] += 1
        if stack: findings["unmatched_groups"].append([sample_index, "unclosed", [r[0] for r in stack]])
        by_frame.append({"sample_index": sample_index, "source_draw": source_draw,
                         "cpu_envelope_ms": (markers[-1][1] - markers[0][1]) / 1000,
                         "gpu_envelope_ms": (markers[-1][2] - markers[0][2]) / 1e6,
                         "segments": dict(segments), "groups": dict(groups)})

    def summarize(rows):
        segment_names = sorted({key for r in rows for key in r["segments"]})
        group_names = sorted({key for r in rows for key in r["groups"]})
        segments = []
        for name in segment_names:
            present = [r["segments"][name] for r in rows if name in r["segments"]]
            segments.append({"path": name, "structural_marker": name.rsplit(" / ", 1)[-1].startswith(("> ", "< ")),
                             "cpu_ms": stats([v[0] for v in present]), "gpu_ms": stats([v[1] for v in present]),
                             "occurrences_per_frame": sorted({v[2] for v in present})})
        groups = [{"path": name, "cpu_ms": stats([r["groups"][name][0] for r in rows if name in r["groups"]]),
                   "gpu_ms": stats([r["groups"][name][1] for r in rows if name in r["groups"]])} for name in group_names]
        return {"frames": len(rows), "marker_envelope_cpu_ms": stats([r["cpu_envelope_ms"] for r in rows]),
                "marker_envelope_gpu_ms": stats([r["gpu_envelope_ms"] for r in rows]),
                "disjoint_adjacent_segments": segments, "inclusive_groups_do_not_add_to_segments": groups}

    mapped_draws = {r["source_draw"] for r in by_frame if r["source_draw"] is not None}
    component_window = None
    selected = by_frame
    if component is not None and component_frame_offset is not None:
        expected = {int(r["frame"]) - component_frame_offset for r in component["frames"]}
        selected = [r for r in by_frame if r["source_draw"] in expected]
        component_window = {"frame_index_offset_explicitly_supplied": component_frame_offset,
                            "expected_source_draws": sorted(expected), "captured_source_draws": sorted(expected & mapped_draws),
                            "missing_source_draws": sorted(expected - mapped_draws), "expected": len(expected), "captured": len(selected)}
    blocking_counts = {k: v for k, v in raw["counts"].items() if v and ("dropped" in k or k in ["read_errors", "pending_timeouts", "rd_absent"])}
    valid = bool(by_frame) and not any(findings.values()) and not blocking_counts
    launch_flag = bool(run and "--gpu-profile" in run.get("command", []) and run.get("ok") and run.get("exitCode") == 0 and not run.get("errors"))
    return {"schema": "godot-native-render-observer-analysis-v1", "raw_gpu_validated_unchanged": raw.get("gpu_validated"),
            "review": {"usable_nonempty_timestamp_samples": valid and launch_flag,
                       "complete_window": valid and not raw.get("pending_read_at_stop") and not (component_window and component_window["missing_source_draws"]),
                       "clean_performance_acceptance": False, "full_high_acceptance": False,
                       "physical_present_measured": False, "owned_launch_gpu_profile_verified": launch_flag},
            "raw_counts": raw["counts"], "blocking_counts": blocking_counts, "accepted_samples": len(samples), "nonempty_samples": len(by_frame),
            "empty_sample_indices": empty, "pending_read_at_stop": raw.get("pending_read_at_stop"),
            "reported_frame_tokens": tokens, "frame_delays": sorted({r.get("frame_delay") for r in samples if r.get("frame_delay") is not None}),
            "thread": {"id_namespace": "Godot logical Thread::ID; not Win32 TID", "main_id": raw["metadata"]["main_thread_id"],
                       "sample_read_ids": sorted({r.get("thread_id") for r in samples}),
                       "sample_read_all_on_render_thread": all(r.get("is_on_render_thread") is True for r in samples),
                       "boundary_ids": sorted({r[3] for r in raw["boundaries"]}),
                       "thread_model_setting": raw["metadata"].get("thread_model_setting")},
            "findings": findings, "cpu_envelope_source_mapping": mappings,
            "boundary_source_draws_without_marker_capture": sorted({r[2] for r in pre} - mapped_draws),
            "component_measurement_window": component_window, "actual_marker_names": sorted(marker_names),
            "all_nonempty_including_startup": summarize(by_frame), "selected_window": summarize(selected),
            "observer_read_cpu_ms": stats([(r["read_exit_us"] - r["read_enter_us"]) / 1000 for r in samples if "read_exit_us" in r]),
            "percentile_method": "linear interpolation at (n-1)*p, per-frame sum of repeated identical segment paths",
            "limits": ["CPU segment is render-thread wall interval, not exclusive CPU self time", "GPU segment is queue elapsed time including dependencies/feed gaps",
                       "Inclusive group totals overlap segments; never add them", "Last marker excludes later unmarked submit/present work",
                       "Source draw mapping uses original CPU envelope contained in pre/post; token is not pose identity", "Snapshot PBR diagnostic has no full AI or High parity"]}


def markdown(result):
    window = result["selected_window"]
    lines = ["# Offline native GPU observer review", "", "Diagnostic frozen PBR component only; no full AI/High/FPS acceptance. Raw `gpu_validated:false` is unchanged.", "",
             f"Samples: {result['accepted_samples']} accepted, {result['nonempty_samples']} nonempty, {len(result['empty_sample_indices'])} startup empty. Pending at shutdown: `{result['pending_read_at_stop']}`.", "",
             f"Selected mapped window: {window['frames']} frames. See JSON for exact missing-window and token/ring mapping.", "",
             "CPU/GPU values below are **disjoint adjacent-marker intervals**, in milliseconds. Structural markers are omitted here; JSON retains every interval. Repeated same-path markers are summed per frame. Inclusive group totals are separately reported and must not be added.", "",
             "| Marker path | n | CPU P50 | CPU P95 | GPU P50 | GPU P95 |", "|---|---:|---:|---:|---:|---:|"]
    for row in sorted(window["disjoint_adjacent_segments"], key=lambda r: r["gpu_ms"]["p50"], reverse=True):
        if row["structural_marker"]: continue
        c, g = row["cpu_ms"], row["gpu_ms"]
        lines.append(f"| {row['path']} | {c['n']} | {c['p50']:.6f} | {c['p95']:.6f} | {g['p50']:.6f} | {g['p95']:.6f} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--run", type=Path)
    parser.add_argument("--component", type=Path)
    parser.add_argument("--component-frame-offset", type=int)
    parser.add_argument("--out-prefix", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(load(args.raw), load(args.run) if args.run else None,
                     load(args.component) if args.component else None, args.component_frame_offset)
    result["inputs"] = [{"path": str(p), "sha256": sha(p)} for p in [args.raw, args.run, args.component] if p]
    outputs = [Path(str(args.out_prefix) + suffix) for suffix in [".json", ".md"]]
    if any(p.exists() for p in outputs): raise SystemExit("Refusing to overwrite analysis evidence")
    outputs[0].write_bytes((json.dumps(result, indent=2) + "\n").encode())
    outputs[1].write_bytes(markdown(result).encode())
    print(json.dumps({"review": result["review"], "samples": result["nonempty_samples"], "selected": result["selected_window"]["frames"]}, indent=2))
