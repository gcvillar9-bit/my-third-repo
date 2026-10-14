/**
 * WebAudio graph (synthesised sources only, no audio files):
 *
 *   pad slots ─▶ padBus ─┐
 *   whoosh (band-passed noise) ─┼─▶ space ─┬─▶ master ─▶ destination
 *   rumble (low sines + noise) ─┘          └─▶ echo (delay feedback) ─▶ master
 *   wind (low-passed noise × gusts), footsteps, chime ─▶ atmo ─▶ master
 *
 * `space` is muted by "realistic silence"; the master gain is the volume. Parameters move with
 * setTargetAtTime and pad zones crossfade with linear ramps, so nothing clicks.
 */
import { noteHz, PAD_VOICES, type FilteredGain, type Zone } from './mapping';

interface PadSlot {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
}

type Param = 'whoosh' | 'whooshHz' | 'wind' | 'windHz' | 'rumble' | 'volume' | 'space';

const PAD_LEVEL = 0.32;
const RUMBLE_LEVEL = 0.5;

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly space: GainNode;
  private readonly atmo: GainNode;
  private readonly padBus: GainNode;
  private readonly echoIn: GainNode;
  private readonly noise: AudioBuffer;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private pads: PadSlot[] = [];
  private readonly whooshGain: GainNode;
  private readonly whooshFilter: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly rumbleGain: GainNode;
  private readonly last: Record<Param, number> = {
    whoosh: -1,
    whooshHz: -1,
    wind: -1,
    windHz: -1,
    rumble: -1,
    volume: -1,
    space: -1,
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const t = ctx.currentTime;
    this.master = this.gain(0);
    this.master.connect(ctx.destination);
    this.space = this.gain(1, this.master);
    this.atmo = this.gain(1, this.master);
    this.padBus = this.gain(PAD_LEVEL, this.space);

    // Echo "reverb": a filtered feedback delay, cheap and convolution-free.
    this.echoIn = this.gain(0.35);
    this.space.connect(this.echoIn);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.43;
    const damp = this.filter('lowpass', 1800);
    const feedback = this.gain(0.38);
    this.echoIn.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(this.gain(0.6, this.master));

    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Flight whoosh.
    this.whooshFilter = this.filter('bandpass', 400, 0.9);
    this.whooshGain = this.gain(0, this.space);
    this.noiseSource(0).connect(this.whooshFilter).connect(this.whooshGain);

    // Atmospheric wind with slow gusts (two incommensurate LFOs on the gain and the cutoff).
    this.windFilter = this.filter('lowpass', 400, 0.6);
    const high = this.filter('highpass', 70);
    this.windGain = this.gain(0);
    const gust = this.gain(0.72, this.atmo);
    this.noiseSource(0.7).connect(this.windFilter).connect(high).connect(this.windGain).connect(gust);
    this.lfo(0.13, 0.18, gust.gain);
    this.lfo(0.047, 0.1, gust.gain);
    this.lfo(0.09, 160, this.windFilter.frequency);

    // Black-hole rumble: beating low sines plus deep filtered noise.
    this.rumbleGain = this.gain(0, this.space);
    const swell = this.gain(0.85, this.rumbleGain);
    const rumbleLp = this.filter('lowpass', 120, 0.8);
    rumbleLp.connect(swell);
    for (const [f, type, g] of [
      [31, 'sine', 0.5],
      [32.7, 'sine', 0.45],
      [46.5, 'triangle', 0.25],
      [62, 'sine', 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(this.gain(g, rumbleLp));
      o.start(t);
      this.sources.push(o);
    }
    const rumbleNoise = this.filter('lowpass', 60);
    this.noiseSource(1.3).connect(rumbleNoise).connect(this.gain(0.9, rumbleLp));
    this.lfo(0.06, 0.15, swell.gain);
  }

  /** Master volume (0..1) and realistic silence (mutes pad, whoosh and rumble). */
  setMaster(volume: number, silence: boolean): void {
    this.target(this.master.gain, 'volume', volume, 0.08);
    this.target(this.space.gain, 'space', silence ? 0 : 1, 0.6);
  }

  /** Crossfades the ambient pad to `zone` over `fadeS` seconds. */
  setZone(zone: Zone, fadeS: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const p of this.pads) {
      const g = p.gain.gain;
      const v = g.value;
      g.cancelScheduledValues(t);
      g.setValueAtTime(v, t);
      g.linearRampToValueAtTime(0, t + fadeS);
      for (const n of p.nodes) n.stop(t + fadeS + 0.1);
    }
    const old = this.pads;
    this.pads = [];
    setTimeout(() => old.forEach((p) => p.gain.disconnect()), (fadeS + 0.5) * 1000);

    const voice = PAD_VOICES[zone];
    const slot: PadSlot = { gain: this.gain(0, this.padBus), nodes: [] };
    slot.gain.gain.setValueAtTime(0, t);
    slot.gain.gain.linearRampToValueAtTime(1, t + fadeS);
    const lp = this.filter('lowpass', voice.cutoff, 0.7);
    lp.connect(slot.gain);
    const sum = this.gain(1 / (2 * voice.intervals.length), lp);
    for (const iv of voice.intervals) {
      for (const sign of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = voice.wave;
        o.frequency.value = noteHz(voice.root, iv);
        o.detune.value = sign * voice.detune;
        o.connect(sum);
        o.start(t);
        slot.nodes.push(o);
      }
    }
    // Slow "breathing" of the timbre.
    const l = ctx.createOscillator();
    l.frequency.value = 0.07;
    l.connect(this.gain(voice.cutoff * 0.35, lp.frequency));
    l.start(t);
    slot.nodes.push(l);
    this.pads.push(slot);
  }

  /** Applies the continuous layers (call at ≤ 20 Hz; unchanged values are skipped). */
  apply(whoosh: Readonly<FilteredGain>, wind: Readonly<FilteredGain>, rumble: number): void {
    this.target(this.whooshGain.gain, 'whoosh', whoosh.gain, 0.12);
    this.target(this.whooshFilter.frequency, 'whooshHz', whoosh.cutoff, 0.15, 5);
    this.target(this.windGain.gain, 'wind', wind.gain, 0.35);
    this.target(this.windFilter.frequency, 'windHz', wind.cutoff, 0.4, 5);
    this.target(this.rumbleGain.gain, 'rumble', rumble * RUMBLE_LEVEL, 0.8);
  }

  /** A soft footstep / landing thud; `pitch` scales with surface gravity. */
  thud(strength: number, pitch: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(45 * pitch, t + 0.12);
    const g = this.gain(0, this.atmo);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28 * strength, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const lp = this.filter('lowpass', 700 * pitch);
    const ng = this.gain(0, this.atmo);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.12 * strength, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(lp).connect(ng);
    o.start(t);
    o.stop(t + 0.25);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.12);
    o.onended = () => {
      g.disconnect();
      ng.disconnect();
    };
  }

  /** Soft two-note chime (autopilot arrival). */
  chime(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const g = this.gain(0, this.atmo);
    g.connect(this.echoIn);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    for (const [f, dt] of [
      [659.26, 0],
      [987.77, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(t + dt);
      o.stop(t + 1.7);
    }
    setTimeout(() => g.disconnect(), 2000);
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
    }
    void this.ctx.close().catch(() => undefined);
  }

  private gain(value: number, to?: AudioNode | AudioParam): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (to instanceof AudioNode) g.connect(to);
    else if (to) g.connect(to);
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private noiseSource(offset: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(this.ctx.currentTime, offset);
    this.sources.push(s);
    return s;
  }

  private lfo(freq: number, depth: number, param: AudioParam): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    o.connect(this.gain(depth, param));
    o.start(this.ctx.currentTime);
    this.sources.push(o);
  }

  private target(param: AudioParam, key: Param, v: number, tau: number, eps = 1e-3): void {
    if (Math.abs(this.last[key] - v) <= eps) return;
    this.last[key] = v;
    param.setTargetAtTime(v, this.ctx.currentTime, tau);
  }
}
