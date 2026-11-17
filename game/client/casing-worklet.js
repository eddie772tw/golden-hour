// Casing-only mono source mixer. No game admission, gain, panning or reverb here.
// Scheduling follows the original absolute AudioContext clock. Late receipt is
// reported. It cannot restore a missed onset or advance unrendered source state.
export class CasingMixer {
  constructor(rate, white) { this.rate = rate; this.white = white; this.sources = []; this.stopFrame = Infinity; }
  warm() {
    const common = { start:0, attack:.001, hold:0, decay:.005, gain:.1,
      frequency:1000, frequency1:0, frequencyTime:.003, q:.7, offset:0, noiseRate:1 };
    this.cue([{...common,kind:"tone",frequency1:500},
      ...["lowpass","highpass","bandpass"].map(type=>({...common,kind:"noise",type}))],0);
    this.render(new Float32Array(1024),0);
    this.sources.length=0;
  }
  cue(commands, frame) {
    this.stopFrame = Infinity;
    this.sources = commands.map(command => {
      const issued = command.issuedAt ?? 0, start = Math.max(command.start, issued);
      const first = Math.ceil(start*this.rate);
      const s = { ...command, frame: Math.max(first,frame), phase: 0,
        noise: command.offset * this.rate, x1: 0, x2: 0, y1: 0, y2: 0 };
      s.attackStart = start;
      s.attackEnd = Math.max(command.start+command.attack,issued);
      s.holdEnd = Math.max(command.start+command.attack+command.hold,issued);
      s.decayEnd = Math.max(command.start+command.attack+command.hold+command.decay,issued);
      s.frequencyEnd = Math.max(command.start+command.frequencyTime,issued);
      s.stop = Math.ceil(Math.max(command.start+command.attack+command.hold+command.decay+.03,issued)*this.rate);
      if (s.kind === "tone") {
        // T.tone always schedules frequency automation. Blink's a-rate first
        // quantum starts with phase zero (its fractional-start frequency=0)
        // and reads increments from index0, even when output begins mid-block.
        // Match that boundary rather than analytically advancing a lost phase.
        s.firstQuantumEnd = Math.floor(s.frame/128)*128+128;
        s.frequencyOffset = s.frame%128;
        s.frequency = Math.fround(s.frequency);
        s.frequency1 = Math.fround(s.frequency1);
      }
      if (s.kind === "noise") {
        // playbackRate AudioParam stores a float, including its unity fast path.
        s.noiseRate = Math.fround(s.noiseRate);
        if (s.noiseRate === 1) s.noise = Math.round(s.noise);
        s.noise += (first-start*this.rate)*s.noiseRate;
        // Web Audio low/high-pass Q is in dB; band-pass Q is linear.
        const q = s.type === "bandpass" ? s.q : Math.pow(10, s.q/20);
        const w = 2 * Math.PI * s.frequency / this.rate, c = Math.cos(w), a = Math.sin(w) / (2 * q);
        const norm = 1 / (1 + a);
        const b = s.type === "highpass" ? [(1+c)/2, -(1+c), (1+c)/2]
          : s.type === "lowpass" ? [(1-c)/2, 1-c, (1-c)/2] : [a, 0, -a];
        s.coefficients = [b[0]*norm, b[1]*norm, b[2]*norm, -2*c*norm, (1-a)*norm];
      }
      return s;
    });
  }
  sample(s) {
    const time = s.frame++ / this.rate;
    let value;
    if (s.kind === "tone") {
      value = Math.sin(s.phase);
      const frequencyTime = (s.frame-1 < s.firstQuantumEnd
        ? s.frame-1-s.frequencyOffset : s.frame-1)/this.rate;
      const frequency = s.frequency1 && frequencyTime < s.frequencyEnd
        ? s.frequency * Math.pow(s.frequency1/s.frequency, Math.max(0,frequencyTime-s.attackStart)/(s.frequencyEnd-s.attackStart))
        : s.frequency1 || s.frequency;
      s.phase = (s.phase + 2*Math.PI*Math.fround(frequency)/this.rate) % (2*Math.PI);
    } else {
      const length = this.white.length, index = Math.floor(s.noise) % length, part = s.noise % 1;
      value = this.white[index]*(1-part) + this.white[(index+1)%length]*part;
      s.noise = (s.noise+s.noiseRate) % length;
      const [b0,b1,b2,a1,a2] = s.coefficients;
      const y = b0*value+b1*s.x1+b2*s.x2-a1*s.y1-a2*s.y2;
      s.x2=s.x1; s.x1=value; s.y2=s.y1; s.y1=y;
      value=y;
    }
    const peak = s.gain, floor = Math.max(peak*1e-3, 1e-6);
    const envelope = time < s.attackEnd ? peak*Math.max(0,time-s.attackStart)/(s.attackEnd-s.attackStart)
      : time < s.holdEnd ? peak : time >= s.decayEnd ? floor
      : peak*Math.pow(floor/peak,(time-s.holdEnd)/(s.decayEnd-s.holdEnd));
    return value*envelope;
  }
  render(output, frame) {
    output.fill(0);
    let nonzero = false;
    for (const s of this.sources) {
      const end = Math.min(frame+output.length, s.stop, this.stopFrame);
      for (let at = Math.max(frame,s.frame); at < end; at++) {
        const value = this.sample(s);
        output[at-frame] += value;
        nonzero ||= value !== 0;
      }
    }
    return nonzero;
  }
}

if (typeof AudioWorkletProcessor !== "undefined") {
  registerProcessor("gh-casing-source", class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.mixer = new CasingMixer(sampleRate, options.processorOptions.white);
      this.mixer.warm();
      this.token = 0;
      this.first = false;
      this.port.onmessage = ({ data }) => {
        if (data.type === "cue") {
          this.token = data.token;
          this.cueId = data.cueId;
          this.first = false;
          this.scheduledFrame = Math.min(...data.commands.map(c => Math.ceil(c.start*sampleRate)));
          const effectiveMainFrame = Math.min(...data.commands.map(c=>Math.ceil(Math.max(c.start,c.issuedAt??0)*sampleRate)));
          this.mixer.cue(data.commands, currentFrame);
          this.port.postMessage({ type: "accepted", token: this.token, cueId:this.cueId,
            arrivalFrame:currentFrame,deliveryMissFrames:Math.max(0,currentFrame-effectiveMainFrame),
            leadFrames: this.scheduledFrame-currentFrame,
            expiredSources:this.mixer.sources.filter(s=>s.stop<=currentFrame).length });
        } else if (data.token === this.token) {
          if (data.type === "stop") this.mixer.stopFrame = Math.ceil(data.at*sampleRate);
          if (data.type === "release") this.mixer.sources.length = 0;
        }
      };
      this.port.postMessage({ type: "ready" });
    }
    process(inputs, outputs) {
      if (this.mixer.render(outputs[0][0], currentFrame) && !this.first) {
        this.first = true;
        this.port.postMessage({ type: "firstSample", token: this.token, cueId:this.cueId,
          frame: currentFrame+outputs[0][0].findIndex(value=>value!==0), scheduledFrame:this.scheduledFrame });
      }
      return true;
    }
  });
}
