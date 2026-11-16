import ast
import importlib.util
from pathlib import Path
import unittest
from project_source import project

HERE=Path(__file__).resolve().parent
class Projection(unittest.TestCase):
    def test_exact_projection_regenerates_and_unknown_capture_rejects(self):
        import json
        proof,include=project((HERE/'fixtures/source-post-meter-evidence.json').read_bytes())
        self.assertEqual(json.dumps(proof,indent=2)+'\n',(HERE/'render/fixtures/source-post-proof.json').read_text(encoding='utf8'))
        self.assertEqual(include,(HERE/'render/post_film.gdshaderinc').read_text(encoding='utf8'))
        with self.assertRaises(AssertionError):project(b'{}')

    def test_owning_runner_adapter_compiles_and_stops_before_geometry(self):
        spec=importlib.util.spec_from_file_location('film_capture',HERE/'capture_three_post_film.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        source=module.adapt(module.RUNNER.read_text(encoding='utf8'))
        ast.parse(source);compile(source,'run_browser.film.py','exec')
        before=source.index('pack=page.evaluate(\'(o)=>__ghThreePostFilm.run(o)\'')
        save=source.index('path.write_bytes(payload)',before)
        check=source.index("assert pack['ok']",before)
        stop=source.index('raise SystemExit(0)',before)
        geometry=source.index("page.evaluate(godot_exporter.read_text(encoding='utf-8'))",before)
        self.assertLess(save,check);self.assertLess(check,stop);self.assertLess(stop,geometry)

if __name__=='__main__':unittest.main()
