/**
 * storage.js — Persistencia local (localStorage) para preferencias del dispositivo.
 * NO se usa para el ranking global (ese vive en Supabase); en modo sin conexión
 * se guarda un ranking LOCAL claramente identificado como tal.
 */
import { uuid } from './utils.js';

const PREFIX = 'realorai:';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* modo privado o cuota llena */ }
}

export const storage = {
  read, write,

  /** Identificador anónimo y estable del dispositivo (no es un dato personal). */
  deviceId() {
    let id = read('deviceId', null);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { id = uuid(); write('deviceId', id); }
    return id;
  },

  lastName() { return read('lastName', ''); },
  setLastName(name) { write('lastName', name); },

  prefs() { return { sound: true, difficulty: 'mixed', ...read('prefs', {}) }; },
  setPref(key, value) { write('prefs', { ...this.prefs(), [key]: value }); },

  /** IDs de imágenes vistas recientemente (para no repetir la misma secuencia entre partidas). */
  recentQuestions() { return read('recentQuestions', []); },
  pushRecentQuestions(ids, keep = 30) {
    const merged = [...ids, ...this.recentQuestions().filter((x) => !ids.includes(x))].slice(0, keep);
    write('recentQuestions', merged);
  },
};
