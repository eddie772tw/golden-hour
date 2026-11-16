// Exact RGBA image-buffer operations only. No path/text/gradient/draw no-ops.
export class PixelCanvas {
  #width=300;#height=150;#pixels=new Uint8ClampedArray(300*150*4);#context;
  constructor(fail,{captureDrawCommands=false}={}) {
    const canvas=this;
    this.drawCommands=[];
    const context={canvas,
      createImageData(width,height) {
        size(width,height);return {width,height,data:new Uint8ClampedArray(width*height*4)};
      },
      putImageData(image,dx,dy) {
        if(!Number.isInteger(dx)||!Number.isInteger(dy)||image.data.length!==image.width*image.height*4)
          throw Error('Unsupported pixel-copy shape');
        for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++) {
          const toX=x+dx,toY=y+dy;
          if(toX<0||toY<0||toX>=canvas.width||toY>=canvas.height)continue;
          canvas.#pixels.set(image.data.subarray((y*image.width+x)*4,(y*image.width+x+1)*4),(toY*canvas.width+toX)*4);
        }
      },
      getImageData(sx,sy,width,height) {
        if(canvas.drawCommands.length)return fail('Canvas2D.getImageData requires rasterizer after captured drawing');
        size(width,height);
        if(!Number.isInteger(sx)||!Number.isInteger(sy))throw Error('Unsupported pixel region');
        const image={width,height,data:new Uint8ClampedArray(width*height*4)};
        for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
          const fromX=x+sx,fromY=y+sy;
          if(fromX<0||fromY<0||fromX>=canvas.width||fromY>=canvas.height)continue;
          image.data.set(canvas.#pixels.subarray((fromY*canvas.width+fromX)*4,(fromY*canvas.width+fromX+1)*4),(y*width+x)*4);
        }
        return image;
      },
    };
    if(captureDrawCommands) {
      const record=(name,args)=>{
        if(canvas.drawCommands.length>=32768)return fail('Canvas2D command budget');
        canvas.drawCommands.push({name,args});
      };
      // Output commands, not fake pixels. Any attempt to read their result fails.
      for(const name of ['save','restore','translate','rotate','scale','transform','setTransform','resetTransform',
        'beginPath','closePath','moveTo','lineTo','bezierCurveTo','quadraticCurveTo','arc','ellipse','rect',
        'fill','stroke','clip','fillRect','strokeRect','clearRect','fillText','strokeText','drawImage','setLineDash'])
        context[name]=(...args)=>record(name,args);
      for(const name of ['createLinearGradient','createRadialGradient'])context[name]=(...args)=>{
        const gradient={kind:name,args,stops:[],addColorStop(offset,color){this.stops.push([offset,color]);}};
        return gradient;
      };
    }
    this.#context=new Proxy(context,{get(target,key) {
      if(key in target)return target[key];
      return fail('Canvas2D.'+String(key));
    }});
    this.fail=fail;
  }
  get width(){return this.#width;}
  set width(value){size(value,this.#height);this.#width=value;this.#pixels=new Uint8ClampedArray(value*this.#height*4);}
  get height(){return this.#height;}
  set height(value){size(this.#width,value);this.#height=value;this.#pixels=new Uint8ClampedArray(value*this.#width*4);}
  getContext(type){if(type!=='2d')return this.fail('Canvas.getContext('+type+')');return this.#context;}
}
function size(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)
    throw Error('Unsupported bounded pixel canvas size '+width+'x'+height);
}
