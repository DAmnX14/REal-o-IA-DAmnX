/**
 * effects.js — Efectos visuales: confeti, puntos flotantes, contador animado.
 * Se desactivan si la persona apaga las animaciones con el botón ✨ del juego.
 */
const reduced = () => document.body.classList.contains('reduce-motion');

/** Confeti en canvas a pantalla completa. intensity: 0.3 – 1.5 */
export function confetti(intensity = 1) {
  if (reduced()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  resize();
  const colors = ['#8b5cf6', '#3b82f6', '#22d3ee', '#a78bfa', '#f0abfc', '#facc15'];
  const n = Math.round(160 * intensity);
  const parts = Array.from({ length: n }, () => ({
    x: innerWidth * (0.2 + Math.random() * 0.6) * dpr,
    y: innerHeight * 0.35 * dpr,
    vx: (Math.random() - 0.5) * 14 * dpr,
    vy: (-Math.random() * 16 - 4) * dpr,
    s: (4 + Math.random() * 6) * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - t0 < 3200) requestAnimationFrame(frame); else canvas.remove();
  })(t0);
}

/** Muestra un texto flotante ("+100") que sube y se desvanece sobre un elemento. */
export function floatText(anchor, text, variant = '') {
  const layer = document.getElementById('float-layer');
  if (!layer || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const node = document.createElement('div');
  node.className = `float-text ${variant}`;
  node.textContent = text;
  node.style.left = `${r.left + r.width / 2}px`;
  node.style.top = `${r.top + r.height / 2}px`;
  layer.append(node);
  node.addEventListener('animationend', () => node.remove());
  setTimeout(() => node.remove(), 2500);
}

/** Anima un número de "from" a "to" dentro de un elemento. */
export function countUp(elm, to, { from = Number(elm.dataset.value || 0), duration = 600 } = {}) {
  elm.dataset.value = to;
  if (reduced() || from === to) { elm.textContent = to.toLocaleString('es-AR'); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / duration);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    elm.textContent = v.toLocaleString('es-AR');
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Reinicia una animación CSS de clase en un elemento. */
export function pulse(elm, cls) {
  if (!elm) return;
  elm.classList.remove(cls);
  void elm.offsetWidth; // fuerza reflow
  elm.classList.add(cls);
}
