import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export function readFixtures() {
  const provenance=JSON.parse(readFileSync(new URL('./fixtures/provenance.json',import.meta.url)));
  const data={};
  for(const name of ['baseline.json','initial-world.json']) {
    const bytes=readFileSync(new URL('./fixtures/'+name,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),provenance.fixtures[name].sha256,'Fixture changed: '+name);
    data[name]=JSON.parse(bytes);
  }
  assert.deepEqual(Object.keys(data['baseline.json']),[...provenance.comparedFields,'botCalls']);
  assert.deepEqual(provenance.comparedFields,['manifest','seed','equipment','decisionTrace','events','checkpoints','state','coverage']);
  return {provenance,baseline:data['baseline.json'],initialURL:new URL('./fixtures/initial-world.json',import.meta.url)};
}
