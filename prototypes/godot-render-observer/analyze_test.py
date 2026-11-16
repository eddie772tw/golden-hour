"""Small correctness tests of the actual offline analyzer; no engine launch."""
import copy
import unittest
from analyze import analyze


class AnalyzerTest(unittest.TestCase):
    def raw(self):
        return {"metadata": {"main_thread_id": 1, "thread_model_setting": 1}, "gpu_validated": False,
                "counts": {"read_errors": 0, "samples_dropped": 0}, "pending_read_at_stop": False,
                "boundaries": [["pre", 100, 0, 1, True], ["post", 200, 0, 1, True]],
                "samples": [{"reported_frame_token": 1, "requested_draw_count": 1, "timestamp_count": 5,
                             "frame_delay": 2, "thread_id": 1, "is_on_render_thread": True,
                             "markers": [["Frame Begin", 110, 1000000], ["> Scene", 120, 2000000],
                                         ["Opaque", 130, 3000000], ["< Scene", 150, 5000000], ["End", 160, 6000000]]}]}

    def run_manifest(self):
        return {"command": ["godot", "--gpu-profile"], "ok": True, "exitCode": 0, "errors": []}

    def test_nested_groups_and_disjoint_conservation(self):
        out = analyze(self.raw(), self.run_manifest())
        self.assertTrue(out["review"]["usable_nonempty_timestamp_samples"])
        self.assertEqual(out["cpu_envelope_source_mapping"][0]["token_minus_source_draw"], 1)
        window = out["selected_window"]
        self.assertAlmostEqual(sum(row["gpu_ms"]["mean"] for row in window["disjoint_adjacent_segments"]), 5.)
        self.assertAlmostEqual(window["inclusive_groups_do_not_add_to_segments"][0]["gpu_ms"]["mean"], 3.)

    def test_errors_and_tail_are_not_full_validated(self):
        raw = self.raw()
        raw["pending_read_at_stop"] = True
        out = analyze(raw, self.run_manifest(), {"frames": [{"frame": 1}, {"frame": 2}]}, 1)
        self.assertFalse(out["review"]["complete_window"])
        self.assertEqual(out["component_measurement_window"]["missing_source_draws"], [1])
        self.assertFalse(out["raw_gpu_validated_unchanged"])
        raw["counts"]["read_errors"] = 1
        self.assertFalse(analyze(raw, self.run_manifest())["review"]["usable_nonempty_timestamp_samples"])

    def test_nonmonotonic_or_missing_launch_rejects(self):
        raw = self.raw()
        raw["samples"][0]["markers"][2][2] = 1
        self.assertFalse(analyze(raw, self.run_manifest())["review"]["usable_nonempty_timestamp_samples"])
        self.assertFalse(analyze(self.raw())["review"]["usable_nonempty_timestamp_samples"])


if __name__ == "__main__":
    unittest.main()
