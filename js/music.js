/**
 * music.js — Música de fondo generada en tiempo real con Web Audio API.
 *
 *  • 'menu'     → tema de inicio: arpegio electrónico tranquilo (La menor – Fa – Do – Sol).
 *  • 'suspense' → música de suspenso para la partida: drone grave, latido y ostinato tenso.
 *                 La intensidad sube cuando quedan pocos segundos (setIntensity).
 *
 * No usa archivos de audio (sin descargas ni licencias). Se puede desactivar con el botón 🎵;
 * la preferencia queda guardada en el dispositivo. Los navegadores solo permiten sonar después
 * de un gesto del usuario, por eso arranca con el primer toque o clic.
 */
import { storage } from './storage.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Progresión del tema de inicio (notas MIDI): Am – F – C – G
const MENU_CHORDS = [
  [57, 60, 64], // La menor
  [53, 57, 60], // Fa
  [48, 52, 55], // Do
  [55, 59, 62], // Sol
];
const ARP = [0, 1, 2, 1, 2, 3, 2, 1]; // índices sobre el acorde (+ octava en el 3)

class MusicEngine {
  constructor() {
    this.ctx = null;
    this.track = null;      // pista activa
    this.wanted = null;     // pista pedida (aunque todavía no haya audio)
    this.enabled = storage.prefs().music !== false;
    this.intensity = 0;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.nodes = [];
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    this.ctx = new C();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(this.ctx.destination);
    // eco suave para el arpegio
    this.delay = this.ctx.createDelay(1);
    this.delay.delayTime.value = 0.375;
    const fb = this.ctx.createGain(); fb.gain.value = 0.28;
    const wet = this.ctx.createGain(); wet.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.master);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else if (this.track) this.ctx.resume();
    });
    return this.ctx;
  }

  /** Llamar en un gesto del usuario: habilita el audio y arranca la pista pedida. */
  unlock() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (this.wanted && this.track !== this.wanted) this._start(this.wanted);
  }

  /** Cambia de pista: 'menu' | 'suspense' | null (silencio). */
  play(name) {
    this.wanted = name;
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    if (name === this.track) return;
    if (!name) { this._stop(); return; }
    this._start(name);
  }

  _start(name) {
    this._stop(true);
    this.track = name;
    this.step = 0;
    this.intensity = 0;
    const t = this.ctx.currentTime;
    this.nextTime = t + 0.08;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.ducked ? 0.35 : 1, t + 1.2);
    if (name === 'suspense') this._startDrone();
    this.timer = setInterval(() => this._schedule(), 25);
  }

  _stop(fast = false) {
    clearInterval(this.timer); this.timer = null;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + (fast ? 0.15 : 0.8));
      const nodes = this.nodes; this.nodes = [];
      setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* ya detenido */ } }), fast ? 200 : 900);
    }
    this.track = null;
  }

  /** Baja el volumen (por ejemplo, mientras se lee la explicación). */
  duck(on) {
    this.ducked = on;
    if (!this.ctx || !this.track) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(on ? 0.35 : 1, t + 0.4);
  }

  /** 0 = calma, 1 = máxima tensión (últimos segundos). */
  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  setEnabled(v) {
    this.enabled = !!v;
    storage.setPref('music', this.enabled);
    if (this.enabled) { this.unlock(); this.play(this.wanted); } else this._stop();
  }
  toggle() { this.setEnabled(!this.enabled); return this.enabled; }

  /* ---------------- Síntesis ---------------- */

  _note(freq, t, dur, { type = 'triangle', gain = 0.05, attack = 0.01, release = 0.25, cutoff = 3000, toDelay = false } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.master);
    if (toDelay) g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _kick(t, gain = 0.5, freq = 70) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }

  _startDrone() {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain(); g.gain.value = 0.045;
    f.connect(g).connect(this.master);
    for (const d of [-7, 0, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(33); o.detune.value = d;
      o.connect(f); o.start(); this.nodes.push(o);
    }
    lfo.start(); this.nodes.push(lfo);
  }

  _schedule() {
    const ctx = this.ctx;
    const bpm = this.track === 'menu' ? 96 : 110 + this.intensity * 40;
    const eighth = 60 / bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.track === 'menu') this._menuStep(this.nextTime, eighth);
      else this._suspenseStep(this.nextTime, eighth);
      this.nextTime += eighth;
      this.step += 1;
    }
  }

  _menuStep(t, e) {
    const bar = Math.floor(this.step / 8) % MENU_CHORDS.length;
    const pos = this.step % 8;
    const chord = MENU_CHORDS[bar];
    const idx = ARP[pos];
    const n = idx === 3 ? chord[0] + 12 : chord[idx];
    this._note(midi(n + 12), t, e * 1.6, { type: 'triangle', gain: 0.035, release: e, toDelay: true, cutoff: 2600 });
    if (pos === 0) {
      // colchón (pad) del acorde y bajo
      for (const c of chord) this._note(midi(c), t, e * 8, { type: 'sawtooth', gain: 0.012, attack: 0.6, release: 1.2, cutoff: 900 });
      this._note(midi(chord[0] - 12), t, e * 3, { type: 'sine', gain: 0.07, release: 0.3 });
      this._kick(t, 0.18, 55);
    }
    if (pos === 4) this._note(midi(chord[0] - 12), t, e * 2, { type: 'sine', gain: 0.05 });
  }

  _suspenseStep(t, e) {
    const pos = this.step % 8;
    const k = this.intensity;
    // latido: "lub-dub" cada compás (y cada medio compás con tensión alta)
    if (pos === 0 || (k > 0.6 && pos === 4)) { this._kick(t, 0.32 + k * 0.2, 52); this._kick(t + e * 0.55, 0.2 + k * 0.15, 48); }
    // ostinato tenso: semitono que sube con la intensidad
    const base = k > 0.6 ? 76 : 69;
    const pattern = [0, 1, 0, 1, 0, 1, 3, 1];
    this._note(midi(base + pattern[pos]), t, e * 0.9, { type: 'square', gain: 0.012 + k * 0.02, release: e * 0.5, cutoff: 1800 + k * 2500 });
    // golpe agudo de tensión cada 2 compases
    if (this.step % 16 === 15) this._note(midi(93), t, e * 2, { type: 'sine', gain: 0.025, toDelay: true });
  }
}

export const music = new MusicEngine();
