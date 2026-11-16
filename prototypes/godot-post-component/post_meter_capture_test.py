"""CPU-only adapter/AST checks. No browser or native engine is started."""
from pathlib import Path
import ast
import importlib.util
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('capture_post_meter',HERE/'capture_post_meter.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class CaptureBoundary(unittest.TestCase):
    def test_real_runner_compiles_and_preserves_invalid_report_before_assert(self):
        adapted=module.adapt(module.RUNNER.read_text(encoding='utf8'))
        ast.parse(adapted);compile(adapted,'run_browser.post-meter.py','exec')
        read=adapted.index('pack=page.evaluate(\'(source)=>__ghPostMeter.capture(source)\'')
        save=adapted.index('path.write_bytes(payload)',read)
        check=adapted.index("assert pack['ok']",read)
        stop=adapted.index('raise SystemExit(0)',read)
        geometry=adapted.index("page.evaluate(godot_exporter.read_text(encoding='utf-8'))",read)
        self.assertLess(read,save);self.assertLess(save,check);self.assertLess(check,stop);self.assertLess(stop,geometry)
        self.assertIn("Post meter capture requires --native-loop --quality high",adapted)
        self.assertIn("row[key+'SHA256']=hashlib.sha256(payload).hexdigest()",adapted)

    def test_changed_owning_boundary_fails_closed(self):
        with self.assertRaises(AssertionError):module.adapt('print("unknown owning runner")')

if __name__=='__main__':unittest.main()
