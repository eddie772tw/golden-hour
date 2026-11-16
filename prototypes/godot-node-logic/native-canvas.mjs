// Real CPU-only Canvas2D boundary. Chrome raster/metrics parity is not implied.
import {createCanvas,GlobalFonts,Image,ImageData,Path2D,setTextRenderer} from '@napi-rs/canvas';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

setTextRenderer('system');
const fontFiles=[['bahnschrift.ttf','Bahnschrift'],['segoeui.ttf','Segoe UI'],['segoeuib.ttf','Segoe UI'],
  ['arial.ttf','Arial'],['arialbd.ttf','Arial'],['ariali.ttf','Arial'],['arialbi.ttf','Arial']];
const fonts=[];
const fontDirectory=process.env.GH_NODE_FONT_DIR||join(process.env.WINDIR||process.env.SystemRoot||'C:/Windows','Fonts');
for(const [file,family] of fontFiles) {
  const path=join(fontDirectory,file);
  if(!existsSync(path))throw Error('Required existing Windows font missing: '+path);
  if(!GlobalFonts.registerFromPath(path,family))throw Error('Font registration failed: '+path);
  fonts.push({file:path,family,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
}
export const metadata={name:'@napi-rs/canvas',version:'1.1.1',textRenderer:'system',fonts,
  node:process.versions.node,napi:process.versions.napi,platform:process.platform,arch:process.arch,
  limits:'Real native Canvas2D CPU raster/metrics; not browser/Godot GPU execution or Chrome pixel parity.'};
export function canvasFactory(fail) {
  return ()=>{
    const canvas=createCanvas(300,150),getContext=canvas.getContext;
    canvas.getContext=function(type,...args){
      if(type!=='2d')return fail('NativeCanvas.getContext('+type+')');
      return getContext.call(this,type,...args);
    };
    return canvas;
  };
}
export const globals={Image,ImageData,Path2D};
