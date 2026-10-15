import type { SceneSound } from '@/scene/Engine';

const STORAGE_KEY = 'sketchbook-sound';
/** Where the running audio is kept on the window, so a later copy of this code can find it. */
const LIVE_KEY = '__sketchbookAudio';
type AudioHolder = { [LIVE_KEY]?: AudioContext };

/** Everything that can be played: the scene's sounds, and the opening's. */
export type Sfx = SceneSound | 'flip' | 'womp' | 'ding' | 'whoosh' | 'bubble';
/** How loud the water is against everything else. */
const AMBIENCE = 0.05;

/**
 * Every sound in the scene, made on the spot from tones and filtered noise: there are no
 * audio files. It is silent until the visitor turns it on, and remembers their choice.
 */
export class Sound {
  enabled = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambience: GainNode | null = null;
  private lastDrip = 0;
  private hushed = false;
  /** Where the sound being made goes: straight out, or through a panner. */
  private out: AudioNode | null = null;
  /** How deep into the night it is, and what sings in it. */
  private night = 0;
  private nightTimer = 0;
  private crickets = [
    { next: 0, pitch: 4300, period: 0.44, pan: -0.55 },
    { next: 0, pitch: 3850, period: 0.63, pan: 0.6 },
  ];
  private nextCroak = 0;

  constructor() {
    // Never leave an earlier instance playing with no switch attached to it. This happens
    // when the page's code is swapped while it is running, as it is during development.
    const stale = (window as unknown as AudioHolder)[LIVE_KEY];
    if (stale && stale.state !== 'closed') void stale.close();
  }

  /** Whether the visitor chose to have sound on last time. */
  static remembered() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      return false;
    }
  }

  /** Turn sound on or off. Must be called from a click or key press the first time. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Private browsing: the choice just will not be remembered.
    }
    if (enabled) this.start();
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(enabled ? 0.55 : 0, now, enabled ? 0.08 : 0.03);
    if (!enabled) {
      // Fade out quickly, then stop the audio engine altogether so nothing can leak through.
      const context = this.context;
      setTimeout(() => {
        if (!this.enabled && context.state === 'running') void context.suspend();
      }, 200);
    }
  }

  /** Keep the water silent for now: the scene is not on show yet. */
  holdAmbience() {
    this.hushed = true;
    if (this.ambience) this.ambience.gain.value = 0;
  }

  /** The scene is on show: let the water fade up. */
  releaseAmbience() {
    this.hushed = false;
    if (this.ambience && this.context) this.ambience.gain.setTargetAtTime(AMBIENCE, this.context.currentTime, 0.6);
  }

  /**
   * How deep into the night it is, from 0 to 1. Crickets and now and then a frog come out
   * with the dark, quieter than the water, and go again at dawn.
   */
  setNight(amount: number) {
    this.night = amount;
  }

  /** Looks a little way ahead and sets down the night's chirps and croaks in time. */
  private tickNight = () => {
    const context = this.context;
    if (!context || !this.enabled || this.hushed || context.state !== 'running') return;
    const level = Math.max(0, (this.night - 0.35) / 0.65);
    const now = context.currentTime;
    for (const cricket of this.crickets) {
      if (cricket.next < now) cricket.next = now + Math.random() * cricket.period;
      while (cricket.next < now + 0.5) {
        if (level > 0) this.chirp(cricket.next, cricket.pitch, 0.011 * level, cricket.pan);
        // Steady, but not a machine; and now and then one rests for a moment.
        cricket.next += cricket.period * (0.92 + Math.random() * 0.16) + (Math.random() < 0.05 ? 1.5 + Math.random() * 2 : 0);
      }
    }
    if (level <= 0.3) this.nextCroak = now + 2 + Math.random() * 6;
    else if (now > this.nextCroak) {
      this.croak(now + 0.05, 0.09 * level, Math.random() * 1.4 - 0.7);
      this.nextCroak = now + 7 + Math.random() * 9;
    }
  };

  /** A sound sent left or right, from -1 to 1. */
  private panned(pan: number): AudioNode {
    const panner = this.context!.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.master!);
    return panner;
  }

  /** One cricket's chirp: three quick pulses of a high, pure note. */
  private chirp(at: number, pitch: number, gain: number, pan: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    oscillator.frequency.value = pitch;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    for (let i = 0; i < 3; i++) {
      const t = at + i * 0.034;
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(gain, t + 0.006);
      envelope.gain.linearRampToValueAtTime(gain * 0.8, t + 0.016);
      envelope.gain.linearRampToValueAtTime(0, t + 0.024);
    }
    oscillator.connect(envelope).connect(this.panned(pan));
    oscillator.start(at);
    oscillator.stop(at + 0.13);
  }

  /** A frog: rib-bit, two low buzzing croaks, each a fast run of clicks. */
  private croak(at: number, gain: number, pan: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 2.5;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    for (const [start, length, from, to] of [
      [0, 0.11, 150, 120],
      [0.17, 0.15, 135, 100],
    ]) {
      const t = at + start;
      oscillator.frequency.setValueAtTime(from, t);
      oscillator.frequency.linearRampToValueAtTime(to, t + length);
      for (let p = 0; p < length; p += 0.016) {
        envelope.gain.setValueAtTime(0, t + p);
        envelope.gain.linearRampToValueAtTime(gain, t + p + 0.004);
        envelope.gain.linearRampToValueAtTime(0, t + p + 0.014);
      }
    }
    oscillator.connect(filter).connect(envelope).connect(this.panned(pan));
    oscillator.start(at);
    oscillator.stop(at + 0.4);
  }

  private start() {
    if (!this.context) {
      const context = new AudioContext();
      this.context = context;
      (window as unknown as AudioHolder)[LIVE_KEY] = context;
      this.master = context.createGain();
      this.master.gain.value = 0;
      this.master.connect(context.destination);

      const length = context.sampleRate * 2;
      this.noise = context.createBuffer(1, length, context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

      this.startAmbience(context);
      this.nightTimer = window.setInterval(this.tickNight, 200);
    }
    void this.context.resume();
  }

  /** Still water against a hull: low filtered noise that swells and fades slowly. */
  private startAmbience(context: AudioContext) {
    this.ambience = context.createGain();
    this.ambience.gain.value = this.hushed ? 0 : AMBIENCE;
    this.ambience.connect(this.master!);
    for (const [frequency, rate, depth] of [
      [420, 0.17, 0.5],
      [900, 0.29, 0.35],
    ]) {
      const source = context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      const swell = context.createGain();
      swell.gain.value = 0.6;
      const wave = context.createOscillator();
      wave.frequency.value = rate;
      const amount = context.createGain();
      amount.gain.value = depth;
      wave.connect(amount).connect(swell.gain);
      source.connect(filter).connect(swell).connect(this.ambience);
      source.start();
      wave.start();
    }
  }

  /** A burst of noise through a filter that sweeps from one pitch to another. */
  private hiss(
    type: BiquadFilterType,
    from: number,
    to: number,
    duration: number,
    gain: number,
    delay = 0,
    q = 1,
    attack = Math.min(0.02, duration * 0.2),
  ) {
    const context = this.context!;
    const t = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(gain, t + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(envelope).connect(this.out ?? this.master!);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
  }

  /** A tone that slides from one pitch to another and dies away. */
  private tone(wave: OscillatorType, from: number, to: number, duration: number, gain: number, delay = 0) {
    const context = this.context!;
    const t = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, t);
    oscillator.frequency.exponentialRampToValueAtTime(to, t + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    oscillator.connect(envelope).connect(this.out ?? this.master!);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.05);
  }

  /** `pan` sends it left or right, from -1 to 1. */
  play = (name: Sfx, amount = 1, pan = 0) => {
    if (!this.enabled || !this.context || !this.master) return;
    this.out = pan ? this.panned(pan) : null;
    this.voice(name, amount);
    this.out = null;
  };

  private voice(name: Sfx, amount: number) {
    switch (name) {
      case 'cast':
        // The rod and line cutting the air.
        this.hiss('bandpass', 500, 2600, 0.3, 0.22 * amount, 0, 2.5);
        break;
      case 'plop':
        this.tone('sine', 340, 95, 0.14, 0.3 * amount);
        this.hiss('highpass', 1800, 900, 0.12, 0.08 * amount);
        break;
      case 'splash':
        this.tone('sine', 260, 70, 0.2, 0.3 * amount);
        this.hiss('lowpass', 3200, 500, 0.35 + 0.25 * amount, 0.28 * amount);
        this.hiss('highpass', 2400, 1400, 0.3, 0.07 * amount, 0.04);
        break;
      case 'bite':
        this.tone('sine', 230, 130, 0.11, 0.22 * amount);
        break;
      case 'creak':
        // Bamboo taking the strain: a low buzz that wavers upward.
        this.tone('sawtooth', 70, 110, 0.5, 0.05 * amount);
        this.tone('sawtooth', 84, 96, 0.34, 0.04 * amount, 0.12);
        this.hiss('bandpass', 380, 520, 0.45, 0.05 * amount, 0, 6);
        break;
      case 'thud':
        this.tone('sine', 120, 46, 0.22, 0.45 * Math.min(amount, 1.4));
        this.hiss('lowpass', 500, 160, 0.16, 0.2 * amount);
        break;
      case 'paper':
        for (const delay of [0, 0.06, 0.13]) this.hiss('bandpass', 2600, 4200, 0.07, 0.07 * amount, delay, 0.8);
        break;
      case 'bubble': {
        // A bubble rising past: two quick notes sliding up, a different pitch each time.
        const pitch = 560 + Math.random() * 220;
        this.tone('sine', pitch, pitch * 1.9, 0.09, 0.06 * amount);
        this.tone('sine', pitch * 1.35, pitch * 2.5, 0.07, 0.035 * amount, 0.05);
        break;
      }
      case 'pop':
        this.tone('sine', 420, 1100, 0.06, 0.3 * amount);
        break;
      case 'flip':
        // A card turning over: air, then a pat as it lands. `amount` is its pitch.
        this.hiss('bandpass', 700 * amount, 2600 * amount, 0.14, 0.11, 0, 1.6);
        this.tone('sine', 210 * amount, 130 * amount, 0.08, 0.2, 0.3);
        this.hiss('lowpass', 1800, 500, 0.05, 0.1, 0.3);
        break;
      case 'womp':
        // Two falling notes: it worked yesterday.
        this.tone('triangle', 196, 175, 0.22, 0.16 * amount);
        this.tone('triangle', 147, 92, 0.42, 0.18 * amount, 0.2);
        break;
      case 'ding':
        this.tone('sine', 1320, 1318, 0.5, 0.11 * amount);
        this.tone('sine', 1980, 1976, 0.32, 0.05 * amount);
        break;
      case 'whoosh':
        // The page sliding apart.
        this.hiss('bandpass', 1500, 320, 0.75, 0.12 * amount, 0.1, 0.8);
        break;
      case 'drip': {
        // Many can land at once; let through only a few, each a slightly different pitch.
        const now = this.context!.currentTime;
        if (now - this.lastDrip < 0.07) break;
        this.lastDrip = now;
        const pitch = 1100 + Math.random() * 900;
        this.tone('sine', pitch, pitch * 1.5, 0.05, 0.05);
        break;
      }
      case 'twinkle': {
        // A firefly lighting up: a tiny glass bell, a different note each time.
        const pitch = 2400 + Math.random() * 1400;
        this.tone('sine', pitch, pitch * 1.003, 0.7, 0.018 * amount);
        this.tone('sine', pitch * 2.01, pitch * 2, 0.3, 0.006 * amount, 0.01);
        break;
      }
      case 'meteor':
        // A soft rush of air that falls as it crosses the sky, then a few sparks as it burns out.
        this.hiss('bandpass', 5200, 1300, 1.2, 0.045 * amount, 0, 1.4, 0.35);
        this.hiss('highpass', 7000, 4000, 0.9, 0.012 * amount, 0.05, 0.7, 0.3);
        for (const delay of [0.85, 0.97, 1.1]) {
          const pitch = 3200 + Math.random() * 1600;
          this.tone('sine', pitch, pitch, 0.22, 0.008 * amount, delay);
        }
        break;
    }
  }

  dispose() {
    this.enabled = false;
    clearInterval(this.nightTimer);
    if (this.master) this.master.gain.value = 0;
    void this.context?.close();
    this.context = null;
  }
}
