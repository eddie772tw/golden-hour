"""Instrument an isolated diagnostic client; never modifies the owning checkout."""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--client', required=True, type=Path)
args = p.parse_args()
repo = Path(__file__).resolve().parents[2]
client = args.client.resolve()
if client == repo:
    raise SystemExit('Use an isolated diagnostic client')
path = client / 'game/core/game.js'
data = path.read_bytes()
before = hashlib.sha256(data).hexdigest()
if b'__ghOwnerCensus' in data:
    raise SystemExit('Already instrumented')
start = data.index(b'      function o0(g0, G0, K0) {', data.index(b'this.compileAsync'))
end = data.index(b'      function h0(g0) {', start)
block = data[start:end]
opening, closing = block.index(b'{'), block.rfind(b'}')
data = data[:start] + block[:opening + 1] + b'''
        const ghC = globalThis.__ghOwnerCensus, ghRow = ghC ? ghC.currentRow : -1, ghStart = ghC ? ghC.parameters(ghRow) : -1;
        try {
''' + block[opening + 1:closing] + b'''
        } finally { if (ghC) ghC.parameterEnd(ghRow, ghStart); }
      }
''' + data[end:]
for marker, hook in [
    (b'      function h0(g0) {', b'\n        if (globalThis.__ghOwnerCensus && g0.uniformsList === null) globalThis.__ghOwnerCensus.list();'),
    (b'      function D(g0, G0, K0, it, ft) {', b'\n        if (globalThis.__ghOwnerCensus) globalThis.__ghOwnerCensus.select();'),
]:
    if data.count(marker) != 1:
        raise SystemExit('Unexpected renderer hook boundary')
    data = data.replace(marker, marker + hook, 1)
path.write_bytes(data)
module_name = 'game/client/pass-owner-census.js'
module = (repo / module_name).read_bytes()
(client / module_name).write_bytes(module)
manifest_path = client.parent / (client.name + '-manifest.json')
manifest = json.loads(manifest_path.read_bytes())
manifest['files']['game/core/game.js'] = hashlib.sha256(data).hexdigest()
manifest['files'][module_name] = hashlib.sha256(module).hexdigest()
manifest['ownerCensusInstrumentation'] = {'baseCoreSHA256': before, 'diagnosticOnly': True,
                                         'hook': 'D/o0/h0, no material or draw changes'}
manifest_path.write_bytes((json.dumps(manifest, indent=2) + '\n').encode())
print(json.dumps(manifest['ownerCensusInstrumentation']))
