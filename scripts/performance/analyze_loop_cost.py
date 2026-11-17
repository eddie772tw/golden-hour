"""Read-only calculation from a completed gh-loop-cost-v1 diagnostic export.

No browser, GPU or product edits. Raw-ring percentiles are never substituted for
whole-window aggregates, and mixed phase durations are only cost ceilings.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path

PRESENTATION_CANDIDATES = ("VM", "FX", "FPbody", "world.callbacks", "lighting.sun", "post.listener", "camera")


def distribution(values):
    values = sorted(values)
    if not values:
        return {"samples": 0}
    def percentile(p):
        x = (len(values) - 1) * p
        i = math.floor(x)
        return values[i] + (values[min(i + 1, len(values) - 1)] - values[i]) * (x - i)
    return {"samples": len(values), "totalMS": sum(values), "meanMS": sum(values) / len(values),
            "p95MS": percentile(.95), "p99MS": percentile(.99), "maxMS": values[-1]}


def analyze(path):
    raw = path.read_bytes()
    data = json.loads(raw)
    observer = data["loopCost"]
    assert observer["schema"] == "gh-loop-cost-v1"
    assert not observer["coverage"]["incompleteTicks"] and not observer["coverage"]["abortedCallbacks"]
    groups = observer["groups"]
    clean = lambda g: g["callbacks"] == g["nativeFixedCallbacks"] == g["playingCallbacks"]
    before_last = {p: 0. for p in PRESENTATION_CANDIDATES}
    catchup = []
    for group in groups:
        total = group["plannedTicks"]
        if total < 2:
            continue
        assert clean(group), "Cannot classify mixed multi-tick aggregate as native catch-up"
        assert group["actualTicks"] == group["callbacks"] * total
        phase_cost = {p: 0. for p in PRESENTATION_CANDIDATES}
        for scope in group["scopes"]:
            if scope["tickIndex"] is None or scope["tickIndex"] >= total - 1:
                continue
            for phase in scope["phases"]:
                if phase["name"] in phase_cost:
                    phase_cost[phase["name"]] += phase["cpuMS"]
                    before_last[phase["name"]] += phase["cpuMS"]
        cost = sum(phase_cost.values())
        catchup.append({"plannedTicks": total, "renderDue": group["renderDue"],
            "callbacks": group["callbacks"], "extraTicks": group["callbacks"] * (total - 1),
            "mixedPhaseUpperMS": cost, "meanUpperMSPerCallback": cost / group["callbacks"],
            "inclusiveCallbackMS": group["inclusiveCallbackMS"], "maxCallbackMS": group["maxCallbackMS"],
            "phaseUpperMS": phase_cost})
    no_render = next(g for g in groups if g["plannedTicks"] == 1 and not g["renderDue"])
    zero_render = next(g for g in groups if g["plannedTicks"] == 0 and g["renderDue"])
    assert clean(no_render) and clean(zero_render)
    one_scope = next(s for s in no_render["scopes"] if s["tickIndex"] == 0)
    no_render_phases = {p: sum(v["cpuMS"] for v in one_scope["phases"] if v["name"] == p)
                        for p in PRESENTATION_CANDIDATES}
    candidate_upper = sum(before_last.values())
    native_tick_invocations = sum(g["plannedTicks"] * g["nativeFixedCallbacks"] for g in groups)
    native_render_callbacks = sum(g["nativeFixedCallbacks"] for g in groups if g["renderDue"])
    timing = data["scenario"]["timing"]
    assert native_tick_invocations == timing["loopStatsDelta"]["logicalTicks"]
    final_tick = data["scenario"]["manifest"]["totalTicks"]
    frames = [f for f in data["measurement"]["frames"]
              if f[3] == "scripted" and f[4] == "playing" and not f[5]
              and isinstance(f[-1], (int, float)) and 0 < f[-1] < final_tick]
    # The first interval crosses the pre-scripted boundary; exclude it.
    intervals = [f[1] for f in frames[1:]]
    render_cpu = [f[2] for f in frames]
    thresholds = [{"thresholdMS": t, "countAbove": sum(x > t for x in intervals),
                   "excessAboveThresholdMS": sum(max(0., x - t) for x in intervals)}
                  for t in [1000 / 60, 1000 / 45, 25, 1000 / 30, 50, 100]]
    callbacks = observer["callbacks"]
    starts = [r[1] for r in callbacks]
    witnesses = []
    for frame in sorted(frames[1:], key=lambda f: f[1], reverse=True)[:8]:
        idx = bisect.bisect_right(starts, frame[0]) - 1
        witness = {"renderEntryMS": frame[0], "submittedIntervalMS": frame[1],
                   "renderCPUMS": frame[2], "logicalTick": frame[-1], "callbackRetained": False}
        if idx >= 0 and frame[0] <= callbacks[idx][1] + callbacks[idx][2] + .001:
            row = callbacks[idx]
            witness.update({"callbackRetained": True, "callback": row,
                "gapSincePreviousObservedSpanMS": None if idx == 0 else row[1] - callbacks[idx-1][1] - callbacks[idx-1][2],
                "previousCallback": None if idx == 0 else callbacks[idx-1]})
        witnesses.append(witness)
    simulation_uploads = {"calls": 0, "payloadBytes": 0, "allocationBytes": 0}
    render_uploads = dict(simulation_uploads)
    other_uploads = dict(simulation_uploads)
    for group in groups:
        for scope in group["scopes"]:
            for phase in scope["phases"]:
                dst = simulation_uploads if scope["tickIndex"] is not None else render_uploads if phase["name"] == "render" else other_uploads
                dst["calls"] += phase["uploadCalls"]
                dst["payloadBytes"] += phase["uploadPayloadBytes"]
                dst["allocationBytes"] += phase["bufferAllocationBytes"]
    return {"schema": "gh-loop-cost-analysis-v1", "diagnosticOnly": True,
        "source": {"file": path.name, "sha256": hashlib.sha256(raw).hexdigest(),
            "coreSHA256": data["coreSHA256"], "clientCommit": data["clientSource"]["commit"],
            "features": data["candidateFeatures"], "quality": data["quality"]},
        "window": {"logicalTicks": native_tick_invocations, "scenarioElapsedMS": timing["elapsedMs"],
            "runnerPollingElapsedMS": data["scenarioWallMs"], "nativeRenderCallbacks": native_render_callbacks,
            "benchmarkRenderDeltaAtLogicalBoundary": timing["loopStatsDelta"]["renderFrames"],
            "boundaryNote": "The last native callback can render after the benchmark records its final logical-tick boundary. Subsequent paused callbacks contaminate group1/renderDue=true, not the validated clean multi-tick/no-render groups."},
        "catchup": {"groups": catchup, "extraTicks": sum(g["extraTicks"] for g in catchup),
            "mixedPhaseUpperMS": candidate_upper, "phaseUpperMS": before_last,
            "upperMSPerLogicalTick": candidate_upper / native_tick_invocations,
            "percentOfScenarioWallUpper": candidate_upper / timing["elapsedMs"] * 100,
            "interpretation": "Inclusive mixed-stage ceiling for earlier ticks in multi-tick callbacks, not proven removable work or a predicted FPS/P99 change."},
        "singleTickNoRender": {"callbacks": no_render["callbacks"],
            "inclusiveTickMS": one_scope["inclusiveTickMS"], "inclusiveCallbackMS": no_render["inclusiveCallbackMS"],
            "mixedPhaseUpperMS": sum(no_render_phases.values()), "phaseUpperMS": no_render_phases,
            "meanMixedPhaseMSPerCallback": sum(no_render_phases.values()) / no_render["callbacks"],
            "zeroTickRenderCallbacks": zero_render["callbacks"],
            "globalTickMinusRenderInvocationDifference": native_tick_invocations - native_render_callbacks,
            "interpretation": "Do not add 666ms to catch-up savings: almost one-for-one zero-tick render callbacks need the latest presentation. Deferral mostly relocates work and can load the render callback. Tick-minus-render count is only an invocation-count screen, not measured removable milliseconds."},
        "diagnosticFrameTimes": {"filter": "scripted/playing/visible/0<tick<manifest.totalTicks; first cross-phase interval excluded", "percentileMethod": "linear interpolation on sorted observed values", "submittedIntervals": distribution(intervals),
            "renderCPU": distribution(render_cpu), "thresholds": thresholds, "longIntervalWitnesses": witnesses,
            "interpretation": "Submission and main-thread wall spans, not physical present/GPU elapsed/primary FPS. Gaps are outside observed spans, not attribution to any browser/audio/GPU thread."},
        "uploads": {"simulationScopes": simulation_uploads, "renderScopes": render_uploads, "otherScopes": other_uploads,
            "interpretation": "Actual GL argument payloads; repeated CPU dirty writes do not establish repeated uploads."},
        "coverage": observer["coverage"], "overhead": observer["overhead"],
        "limitations": ["All phase aggregates retained; raw callback prefix dropped, so global phase-tail attribution unavailable",
            "Candidate phases contain native logic, timers, RNG, events and dependencies; real removable work is smaller",
            "0/1-tick mixed paused group cannot be exactly demixed from its aggregate",
            "Per-callback phase samples are not recorded; mean candidate cost cannot be subtracted from max/P99 callback",
            "Single instrumented shader-warmup-on diagnostic, no unobserved paired FPS inference"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf8", newline="\n")
    print(json.dumps({"catchupUpperMS": result["catchup"]["mixedPhaseUpperMS"],
        "extraTicks": result["catchup"]["extraTicks"],
        "noRenderRelocationUpperMS": result["singleTickNoRender"]["mixedPhaseUpperMS"],
        "tickMinusRenderCount": result["singleTickNoRender"]["globalTickMinusRenderInvocationDifference"],
        "intervals": result["diagnosticFrameTimes"]["submittedIntervals"]}))
