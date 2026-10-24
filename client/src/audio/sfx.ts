/**
 * Minimal synthesized sound cues keyed by Angband's message sound names
 * (list-message.h).  No audio assets are required; a sound pack mapping the
 * same names to files could replace this later.
 */
type Voice = { type: OscillatorType; f0: number; f1: number; dur: number; gain: number; noise?: boolean };

const CUES: Record<string, Voice> = {
  hit: { type: 'square', f0: 220, f1: 90, dur: 0.09, gain: 0.25, noise: true },
  miss: { type: 'triangle', f0: 600, f1: 300, dur: 0.07, gain: 0.12 },
  kill: { type: 'sawtooth', f0: 300, f1: 60, dur: 0.25, gain: 0.25, noise: true },
  level: { type: 'triangle', f0: 440, f1: 880, dur: 0.4, gain: 0.25 },
  death: { type: 'sawtooth', f0: 200, f1: 40, dur: 1.2, gain: 0.3 },
  shoot: { type: 'triangle', f0: 900, f1: 400, dur: 0.08, gain: 0.15 },
  hitwall: { type: 'square', f0: 90, f1: 70, dur: 0.06, gain: 0.15, noise: true },
  opendoor: { type: 'sawtooth', f0: 120, f1: 160, dur: 0.18, gain: 0.12 },
  shutdoor: { type: 'square', f0: 140, f1: 80, dur: 0.12, gain: 0.15, noise: true },
  stairs_down: { type: 'triangle', f0: 300, f1: 120, dur: 0.5, gain: 0.18 },
  quaff: { type: 'sine', f0: 500, f1: 900, dur: 0.15, gain: 0.15 },
  eat: { type: 'square', f0: 200, f1: 180, dur: 0.1, gain: 0.1, noise: true },
  teleport: { type: 'sine', f0: 200, f1: 1600, dur: 0.35, gain: 0.15 },
  hitpoint_warn: { type: 'square', f0: 880, f1: 880, dur: 0.15, gain: 0.12 },
  dig: { type: 'square', f0: 110, f1: 90, dur: 0.08, gain: 0.15, noise: true },
  study: { type: 'sine', f0: 660, f1: 990, dur: 0.25, gain: 0.12 },
  bell: { type: 'sine', f0: 1000, f1: 1000, dur: 0.08, gain: 0.08 },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  volume = 0.5;

  /** Browsers require a user gesture before audio may start */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: string | undefined): void {
    if (!name || !this.ctx || this.volume <= 0) return;
    let v = CUES[name];
    if (!v && name.startsWith('mon_')) v = CUES.hit;
    if (!v) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v.gain * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
    g.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.f1), t + v.dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + v.dur);
    if (v.noise) {
      const len = Math.floor(ctx.sampleRate * v.dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.value = v.gain * this.volume * 0.6;
      src.connect(ng);
      ng.connect(ctx.destination);
      src.start(t);
    }
  }
}
