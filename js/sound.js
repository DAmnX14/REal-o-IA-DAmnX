/**
 * sound.js — Efectos de sonido sintetizados con Web Audio API.
 * No se usan archivos de audio externos (sin problemas de licencias ni descargas).
 * Se pueden desactivar desde el botón de sonido (preferencia guardada en el dispositivo).
 */
import { storage } from './storage.js';

let ctx = null;
let enabled = storage.prefs().sound !== false;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { start = 0, dur = 0.12, type = 'sine', gain = 0.12, slideTo = null } = {}) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

const library = {
  click: () => tone(660, { dur: 0.05, type: 'triangle', gain: 0.06 }),
  tick: () => tone(1200, { dur: 0.05, type: 'square', gain: 0.04 }),
  tickUrgent: () => tone(1600, { dur: 0.07, type: 'square', gain: 0.06 }),
  correct: () => { tone(660, { dur: 0.1, type: 'triangle' }); tone(990, { start: 0.09, dur: 0.18, type: 'triangle' }); },
  wrong: () => { tone(220, { dur: 0.25, type: 'sawtooth', gain: 0.07, slideTo: 140 }); },
  timeout: () => { tone(440, { dur: 0.15, type: 'square', gain: 0.05 }); tone(330, { start: 0.15, dur: 0.25, type: 'square', gain: 0.05 }); },
  streak: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { start: i * 0.07, dur: 0.12, type: 'triangle', gain: 0.09 })),
  finish: () => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, { start: i * 0.11, dur: 0.18, type: 'triangle', gain: 0.1 })),
};

export const sound = {
  play(name) { if (enabled && library[name]) { try { library[name](); } catch { /* sin audio */ } } },
  get enabled() { return enabled; },
  setEnabled(v) { enabled = !!v; storage.setPref('sound', enabled); if (enabled) ac(); },
  toggle() { this.setEnabled(!enabled); return enabled; },
  /** Llamar en el primer gesto del usuario (requisito de los navegadores). */
  unlock() { if (enabled) ac(); },
};
