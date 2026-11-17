// Isolated transform applied to the pinned core only by the diagnostic loader.
import assert from "node:assert/strict";
export function patchCore(source) {
    source=source.replaceAll("\r\n","\n");
    function swap(a,b){
        assert.equal(source.split(a).length,2,a);
        source=source.replace(a,()=>b);
    }
    swap("    function b(J) {\n      for (let Q of J.srcs) n(Q);",
        '    function b(J) {\n      __casing.observe("release",J,o);\n      for (let Q of J.srcs) n(Q);');
    swap("      let A0 = o.ctx.currentTime, N0 = J.out.gain;",
        '      __casing.observe("target",J,o,{constant:Q,target:J.level*i0});\n      if(J.compactCasing)return;\n      let A0 = o.ctx.currentTime, N0 = J.out.gain;');
    swap("J.dying = true, o.active--, o.cats[J.cat]--;",
        'J.dying = true, o.active--, o.cats[J.cat]--; __casing.observe("steal",J,o,{constant:Q});');
    swap("Mt = this.out = i(1), St = Mt;",`Mt, St;
        if (__casing.enabled && N0 === "casing") {
          this.compactCasing = true;
          this.sourceCount = 0;
          if (Q && isFinite(Q.x + Q.y + Q.z)) {
            const dx = Q.x-o.lx, dy = Q.y-o.ly, dz = Q.z-o.lz;
            this.dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
            xt *= 1-Lw(i0.maxDist*.7,i0.maxDist,this.dist);
            xt *= i0.ref/(i0.ref+i0.roll*Math.max(0,this.dist-i0.ref));
          }
          this.level = xt;
        } else {
        Mt = this.out = i(1); St = Mt;`);
    swap("this.nodes.push(Mt), this.t = mt, this.end = mt + 0.1, this.sum = Mt, o.voices.push(this)",
        'this.nodes.push(Mt); } this.t = mt, this.end = mt + 0.1, this.sum = Mt, __casing.observe("create",this,o), o.voices.push(this)');
    // The S0 branches and partials call order stay in the owning bundle. Each eligible
    // noise consumes one start-offset draw. Voice lifetime uses u()'s operation order.
    for(const method of ["tone","noise"]){
        swap("      "+method+"(Q) {\n        let i0 = Q.g ?? 1;",`      ${method}(Q) {
        if (this.compactCasing) {
          if (!((Q.g ?? 1)>1e-5)) return null;
          const start=this.t+(Q.t||0)*this.st;
          const end=start+(Q.a??.001)+(Q.hold||0)*this.st+(Q.d??.1)*this.st;
          ${method==="noise"?"Math.random();":""}
          this.sourceCount++;
          if(end+.08>this.end)this.end=end+.08;
          return null;
        }
        let i0 = Q.g ?? 1;`);
    }
    return source;
}
