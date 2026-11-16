"""CPU-only owning-runner injection checks; never starts a browser."""
import ast
import importlib.util
import os
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('compiled_capture',HERE/'capture_compiled_materials.py')
capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)

class CaptureBoundary(unittest.TestCase):
    def test_paused_capture_stops_before_geometry_and_preserves_stream_checks(self):
        root=Path(os.environ.get('GH_GODOT_SOURCE_ROOT',HERE.parents[1]))
        source=(root/'scripts/performance/run_browser.py').read_text(encoding='utf8')
        adapted=capture.adapt(source)
        compile(adapted,'run_browser.capture-only.py','exec')
        tree=ast.parse(adapted)
        # Parse validates every injected branch; assert actual early-return boundary.
        before=adapted.index("pack=page.evaluate('(o)=>__ghCompiledMaterials.capture(o)'")
        stop=adapted.index('raise SystemExit(0)',before)
        geometry=adapted.index("page.evaluate(godot_exporter.read_text(encoding='utf-8'))",before)
        self.assertLess(before,stop);self.assertLess(stop,geometry)
        self.assertIn("assert offset==meta['byteLength'] and digest.hexdigest()==meta['sha256']",adapted)
        self.assertIn("assert part['offset']==offset and part['nextOffset']-offset==len(payload)",adapted)
        self.assertIn("pack['counts']['compiledLVIdentityMismatches']==0",adapted)
        self.assertTrue(any(isinstance(node,ast.Raise) for node in ast.walk(tree)))

    def test_source_changed_boundary_fails_instead_of_silent_capture(self):
        with self.assertRaises(AssertionError):capture.adapt('print("not the native owning runner")')

if __name__=='__main__':unittest.main()
