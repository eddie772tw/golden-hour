"""Lossless operator projection from the exact actual post-meter evidence."""
import hashlib
import json
from pathlib import Path
import re
import sys

SOURCE='fe313438559e03f43396111dc59e4f7e9702593dc78aa975ff1d4020c10cd9bb'
sha=lambda b:hashlib.sha256(b).hexdigest()

def project(raw):
    assert sha(raw)==SOURCE,'Exact reviewed post-meter capture required'
    a=json.loads(raw);f=a['finalSource']['fragment']
    assert sha(f.encode())=='d57a2ec1063369281be2d7a85ccfc95c86a9a40ca239159442fd3c437fdd3b1a'
    start=f.index('    vec3 film(vec3 x)');end=f.index('\n',f.index('    float film1(',start))+1
    definitions=f[start:end]
    oetf=re.search(r'^    vec3 toSRGB[^\n]+',f,re.M)[0]+'\n'
    exposure=re.search(r'^      col \*= uExposure[^\n]+',f,re.M)[0]+'\n'
    start=f.index('      float pk = max(col.r, max(col.g, col.b));');end=f.index('      col = toSRGB(col);',start)
    tone=f[start:end]
    current=next(p for p in a['compiled'] if p['current'])
    assert current['id']==123 and current['fragmentSHA256']=='010b92601d5dffe17c397cab6d2dce30b51667fcf376b1775ef4d560d0a6209b'
    selection={'definitions':definitions,'exposureLine':exposure,'filmBlock':tone,'toSRGB':oetf}
    proof={'schema':'gh-source-post-film-unit-proof-v1','sourceCaptureSHA256':sha(raw),'sourceCoreSHA256':a['source']['coreSHA256'],
      'sourceFinalFragmentSHA256':a['finalSource']['fragmentSHA256'],'sourceFinalFragmentBytes':a['finalSource']['fragmentBytes'],
      'currentCompiledFinal':{k:v for k,v in current.items() if k not in ['vertex','fragment']},'sourceRead':a['read'],'sourceParameters':a['exposureParameters'],
      'sourceTimes':{k:a['source'][k] for k in ['tick','gfxTime','gameTime']},'selection':selection,
      'selectionSHA256':sha(json.dumps(selection,separators=(',',':')).encode()),
      'actualUniforms':{k:a['finalUniforms'][k] for k in ['uExposure','uAuto','uHueKeep','uSuppress','uHurt']},
      'scope':'Isolated composition of original exposure operator and film/hue/highlight operators. Full grade/optics/bloom/adaptation history intentionally absent. Not a full original final-post replay.'}
    include='// Literal source operators; diagnostic fixed E replaces the GPU meter input only.\n'+definitions+'uniform float uExposure;\nuniform float uAuto;\nuniform float uHueKeep;\nuniform float uSuppress;\nuniform float uHurt;\nuniform float fixedExposure;\nvec3 sourceExposureFilm(vec3 col) {\n vec4 meter=vec4(fixedExposure,0.0,0.0,1.0);\n'+exposure+tone+' return col;\n}\n'
    proof['nativeIncludeSHA256']=sha(include.encode())
    return proof,include

if __name__=='__main__':
    assert len(sys.argv)==3,'project_source.py INPUT-CAPTURE OUTPUT-DIRECTORY'
    proof,include=project(Path(sys.argv[1]).read_bytes());out=Path(sys.argv[2]);(out/'fixtures').mkdir(parents=True,exist_ok=True)
    data=json.dumps(proof,indent=2)+'\n'
    (out/'fixtures/source-post-proof.json').write_text(data,encoding='utf8',newline='\n')
    (out/'post_film.gdshaderinc').write_text(include,encoding='utf8',newline='\n')
    print(json.dumps({'proofSHA256':sha(data.encode()),'includeSHA256':proof['nativeIncludeSHA256']}))
