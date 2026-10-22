// audio.js — 零素材 WebAudio 合成：音效 + 分层 BGM
import { clamp } from './engine.js';

const NOTE = { D2: 73.42, A2: 110.0, D3: 146.83, F3: 174.61, G3: 196.0, A3: 220.0, C4: 261.63, D4: 293.66, F4: 349.23, A4: 440.0 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.noiseBuf = null;
    this.muted = false;
    this.ready = false;
    this.musicOn = false;
    this.intensity = 0;
    this._intTarget = 0;
    this.step = 0;
    this.nextTime = 0;
    this.bpm = 92;
    this.padNodes = null;
    this._lastSfx = new Map();
  }

  async unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.noiseBuf = this._makeNoise(ctx, 1.2);
    this.ready = true;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  _makeNoise(ctx, dur) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  setIntensity(v) {
    this._intTarget = Number.isFinite(v) ? clamp(v, 0, 1) : 0;
  }

  /* ---------- 基础音元 ---------- */
  _env(t0, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    return g;
  }

  _tone({ freq = 220, freq2 = null, type = 'sine', dur = 0.2, gain = 0.3, delay = 0, dest = null, pan = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freq2 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    const g = this._env(t0, 0.005, dur, gain);
    let node = o;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      node = p;
    }
    node.connect(g);
    g.connect(dest || this.sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.15, gain = 0.2, f0 = 1200, f1 = 400, q = 1.2, type = 'bandpass', delay = 0, dest = null }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur);
    bp.Q.value = q;
    const g = this._env(t0, 0.004, dur, gain);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest || this.sfxGain);
    src.start(t0, Math.random() * 0.4);
    src.stop(t0 + dur + 0.06);
  }

  /* ---------- 音效 ---------- */
  play(name, opts = {}) {
    if (!this.ready) return;
    // 同名音效 30ms 内不重复触发，避免多段命中糊成一团
    const now = this.ctx.currentTime;
    const last = this._lastSfx.get(name) || 0;
    if (now - last < 0.028 && !opts.force) return;
    this._lastSfx.set(name, now);
    const pan = opts.pan || 0;
    const v = opts.vol == null ? 1 : opts.vol;

    switch (name) {
      case 'swing':
        this._noise({ dur: 0.16, gain: 0.13 * v, f0: 2100, f1: 320, q: 0.9 });
        this._tone({ freq: 320, freq2: 120, type: 'triangle', dur: 0.1, gain: 0.05 * v });
        break;
      case 'swingHeavy':
        this._noise({ dur: 0.34, gain: 0.2 * v, f0: 1500, f1: 160, q: 1.4 });
        this._tone({ freq: 180, freq2: 60, type: 'sawtooth', dur: 0.26, gain: 0.11 * v });
        break;
      case 'hit':
        this._noise({ dur: 0.1, gain: 0.2 * v, f0: 900, f1: 220, q: 0.8 });
        this._tone({ freq: 150, freq2: 48, type: 'sine', dur: 0.16, gain: 0.26 * v, pan });
        break;
      case 'crit':
        this._noise({ dur: 0.14, gain: 0.24 * v, f0: 2600, f1: 500, q: 1.1 });
        this._tone({ freq: 220, freq2: 60, type: 'square', dur: 0.18, gain: 0.16 * v });
        this._tone({ freq: 1320, freq2: 660, type: 'triangle', dur: 0.22, gain: 0.1 * v, delay: 0.01 });
        break;
      case 'dodge':
        this._noise({ dur: 0.26, gain: 0.12 * v, f0: 300, f1: 2400, q: 0.7 });
        break;
      case 'hurt':
        this._tone({ freq: 110, freq2: 44, type: 'sawtooth', dur: 0.3, gain: 0.24 * v });
        this._noise({ dur: 0.2, gain: 0.16 * v, f0: 500, f1: 120, q: 0.6 });
        break;
      case 'block':
        this._tone({ freq: 780, freq2: 520, type: 'square', dur: 0.1, gain: 0.1 * v });
        this._noise({ dur: 0.1, gain: 0.1 * v, f0: 3000, f1: 900, q: 2 });
        break;
      case 'shoot':
        this._tone({ freq: 640, freq2: 180, type: 'square', dur: 0.18, gain: 0.09 * v, pan });
        this._noise({ dur: 0.12, gain: 0.07 * v, f0: 1800, f1: 600, q: 1.5 });
        break;
      case 'telegraph':
        this._tone({ freq: 300, freq2: 620, type: 'triangle', dur: 0.3, gain: 0.05 * v, pan });
        break;
      case 'boom':
        this._tone({ freq: 90, freq2: 26, type: 'sine', dur: 0.55, gain: 0.36 * v });
        this._noise({ dur: 0.42, gain: 0.22 * v, f0: 700, f1: 70, q: 0.5 });
        break;
      case 'die':
        this._tone({ freq: 420, freq2: 52, type: 'sawtooth', dur: 0.5, gain: 0.16 * v, pan });
        this._noise({ dur: 0.4, gain: 0.13 * v, f0: 1400, f1: 120, q: 0.7, delay: 0.03 });
        break;
      case 'spawn':
        this._tone({ freq: 60, freq2: 190, type: 'sine', dur: 0.4, gain: 0.1 * v });
        break;
      case 'levelup':
        [NOTE.D4, NOTE.F4, NOTE.A4, NOTE.D4 * 2].forEach((f, i) =>
          this._tone({ freq: f, type: 'triangle', dur: 0.34, gain: 0.13, delay: i * 0.075 }));
        break;
      case 'clear':
        [NOTE.D3, NOTE.A3, NOTE.D4].forEach((f, i) =>
          this._tone({ freq: f, type: 'sine', dur: 0.9, gain: 0.12, delay: i * 0.05 }));
        break;
      case 'ui':
        this._tone({ freq: 880, freq2: 1180, type: 'sine', dur: 0.07, gain: 0.07 });
        break;
      case 'step':
        this._noise({ dur: 0.07, gain: 0.035 * v, f0: 420, f1: 160, q: 1.1 });
        break;
      default:
        break;
    }
  }

  /* ---------- BGM ---------- */
  startMusic() {
    if (!this.ready || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.12;
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 2.5);
    this._startPad();
  }

  stopMusic(fade = 1.2) {
    if (!this.ready || !this.musicOn) return;
    this.musicOn = false;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0.0001, t + fade);
    if (this.padNodes) {
      const { a, b, filter, gain } = this.padNodes;
      gain.gain.linearRampToValueAtTime(0.0001, t + fade);
      setTimeout(() => {
        try { a.stop(); b.stop(); } catch (e) { /* already stopped */ }
      }, (fade + 0.2) * 1000);
      this.padNodes = null;
    }
  }

  _startPad() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 3;
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sawtooth';
    b.type = 'sawtooth';
    a.frequency.value = NOTE.D2;
    b.frequency.value = NOTE.D2 * 1.005;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    a.start(t);
    b.start(t);
    this.padNodes = { a, b, filter, gain };
  }

  /** 每帧调用，提前 0.15s 调度 */
  update(dt) {
    if (!this.ready) return;
    this.intensity += (this._intTarget - this.intensity) * Math.min(1, dt * 2);
    if (this.padNodes) {
      const f = 300 + this.intensity * 900;
      this.padNodes.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.4);
    }
    if (!this.musicOn) return;
    const ctx = this.ctx;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.18) {
      this._scheduleStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 64;
      this.nextTime += stepDur;
    }
  }

  _scheduleStep(step, t) {
    const ctx = this.ctx;
    const s = step % 16;
    const dest = this.musicGain;
    const I = this.intensity;

    const kick = (gain = 0.34) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.3);
    };

    const hat = (gain) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp);
      hp.connect(g);
      g.connect(dest);
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.08);
    };

    const bass = (freq) => {
      if (!Number.isFinite(freq)) return;
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420 + I * 700, t);
      lp.Q.value = 6;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(lp);
      lp.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.3);
    };

    const pluck = (freq, gain = 0.07) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.4);
    };

    if (s === 0 || s === 6) kick(0.3 + I * 0.1);
    if (s === 10) kick(0.22);
    if (I > 0.35 && s === 13) kick(0.16);

    if (s % 4 === 2) hat(0.05 + I * 0.05);
    if (I > 0.5 && s % 2 === 1) hat(0.03 + I * 0.03);

    const BASS_SEQ = [0, -1, 0, -1, 3, -1, 0, -1, 4, -1, -1, 3, 2, -1, 0, -1];
    const roots = [NOTE.D2, NOTE.F3 * 0.5, NOTE.G3 * 0.5, NOTE.A2, NOTE.C4 * 0.5];
    const bi = BASS_SEQ[s];
    if (bi >= 0 && roots[bi]) bass(roots[bi]);

    if (I > 0.25) {
      const ARP = [NOTE.D4, NOTE.F4, NOTE.A4, NOTE.D4 * 2];
      if (s % 4 === 0) pluck(ARP[(step / 4) % 4 | 0], 0.035 + I * 0.04);
    }
    if (I > 0.7 && s === 14) {
      pluck(NOTE.A4 * 2, 0.05);
    }
  }
}

export const audio = new AudioEngine();
