/**
 * timer.js — Cuenta regresiva precisa basada en performance.now().
 * Usa setInterval (y no solo requestAnimationFrame) para seguir funcionando
 * aunque la pestaña quede en segundo plano.
 */
export class Countdown {
  /**
   * @param {number} durationMs
   * @param {{onTick?:(remainingMs:number, fraction:number)=>void, onSecond?:(secondsLeft:number)=>void, onExpire?:()=>void}} handlers
   */
  constructor(durationMs, handlers = {}) {
    this.durationMs = durationMs;
    this.handlers = handlers;
    this.startedAt = null;
    this.stoppedAt = null;
    this._interval = null;
    this._lastSecond = null;
  }

  start() {
    this.stop();
    this.startedAt = performance.now();
    this.stoppedAt = null;
    this._lastSecond = Math.ceil(this.durationMs / 1000);
    this._interval = setInterval(() => this._tick(), 50);
    this._tick();
    return this;
  }

  _tick() {
    const rem = this.remaining();
    this.handlers.onTick?.(rem, rem / this.durationMs);
    const sec = Math.ceil(rem / 1000);
    if (sec !== this._lastSecond) { this._lastSecond = sec; this.handlers.onSecond?.(sec); }
    if (rem <= 0) { this.stop(); this.handlers.onExpire?.(); }
  }

  /** Detiene el reloj y devuelve el tiempo transcurrido en ms. */
  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (this.startedAt != null && this.stoppedAt == null) this.stoppedAt = performance.now();
    return this.elapsed();
  }

  get running() { return this._interval != null; }

  elapsed() {
    if (this.startedAt == null) return 0;
    const end = this.stoppedAt ?? performance.now();
    return Math.min(this.durationMs, Math.max(0, end - this.startedAt));
  }

  remaining() { return Math.max(0, this.durationMs - this.elapsed()); }
}

/** Cronómetro simple (sin límite) para el modo aprendizaje. */
export class Stopwatch {
  start() { this.t0 = performance.now(); this.t1 = null; return this; }
  stop() { if (this.t1 == null) this.t1 = performance.now(); return this.elapsed(); }
  elapsed() { return this.t0 == null ? 0 : (this.t1 ?? performance.now()) - this.t0; }
}
