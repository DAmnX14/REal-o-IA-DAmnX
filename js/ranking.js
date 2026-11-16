/**
 * ranking.js — Pantalla de ranking: pestañas por modo, buscador, paginación,
 * medallas (oro/plata/bronce) y actualización automática cada 20 s mientras está visible.
 */
import { $, escapeHtml, formatPercent, formatSeconds, formatDate, debounce, MODE_LABELS } from './utils.js';

const PAGE_SIZE = 10;
const REFRESH_MS = 20000;

export class RankingView {
  constructor(getBackend) {
    this.getBackend = getBackend;
    this.mode = 'classic';
    this.page = 1;
    this.search = '';
    this.timer = null;
    this.highlight = null;

    document.querySelectorAll('[data-rank-mode]').forEach((b) => b.addEventListener('click', () => {
      this.mode = b.dataset.rankMode; this.page = 1; this.load();
    }));
    $('#rank-search').addEventListener('input', debounce((e) => { this.search = e.target.value; this.page = 1; this.load(); }, 300));
    $('#rank-prev').addEventListener('click', () => { if (this.page > 1) { this.page--; this.load(); } });
    $('#rank-next').addEventListener('click', () => { this.page++; this.load(); });
    $('#rank-refresh').addEventListener('click', () => this.load());
  }

  open({ mode, highlight } = {}) {
    if (mode && mode !== 'learning') this.mode = mode;
    this.highlight = highlight || null;
    this.page = 1;
    this.load();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!document.hidden) this.load(true); }, REFRESH_MS);
  }

  close() { clearInterval(this.timer); this.timer = null; }

  async load(silent = false) {
    document.querySelectorAll('[data-rank-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rankMode === this.mode)));
    const body = $('#rank-body');
    if (!silent) body.innerHTML = '<tr><td colspan="6" class="loading-row"><span class="spinner"></span> Cargando ranking…</td></tr>';
    try {
      const backend = await this.getBackend();
      const scope = backend.kind === 'online' ? 'global' : 'local';
      $('#rank-scope').innerHTML = scope === 'global'
        ? '<span class="pill online">● Ranking global en línea</span>'
        : '<span class="pill local">● Ranking local de este dispositivo</span> <small>Configurá Supabase para compartir el ranking entre dispositivos.</small>';
      const { rows, total } = await backend.getRanking({ mode: this.mode, search: this.search, page: this.page, pageSize: PAGE_SIZE });
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (this.page > pages) { this.page = pages; return this.load(silent); }
      $('#rank-page').textContent = `Página ${this.page} de ${pages} · ${total} jugador${total === 1 ? '' : 'es'}`;
      $('#rank-prev').disabled = this.page <= 1;
      $('#rank-next').disabled = this.page >= pages;
      $('#rank-updated').textContent = `Actualizado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="6" class="empty-row">${this.search ? 'No se encontraron jugadores con ese nombre.' : `Todavía no hay partidas en modo ${MODE_LABELS[this.mode]}. ¡Sé el primero!`}</td></tr>`;
        return;
      }
      body.innerHTML = rows.map((r) => {
        const medal = r.position === 1 ? 'gold' : r.position === 2 ? 'silver' : r.position === 3 ? 'bronze' : '';
        const icon = medal ? `<span class="medal ${medal}" aria-label="Puesto ${r.position}">${r.position}</span>` : r.position;
        const me = this.highlight && r.name.toLowerCase() === this.highlight.toLowerCase() ? ' me' : '';
        return `<tr class="${medal}${me}">
          <td class="pos">${icon}</td>
          <td class="name">${escapeHtml(r.name)}</td>
          <td class="num">${r.score.toLocaleString('es-AR')}</td>
          <td class="num">${formatPercent(r.accuracy)}</td>
          <td class="num">${formatSeconds(r.avgMs)}</td>
          <td class="date">${formatDate(r.date)}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      if (!silent) body.innerHTML = `<tr><td colspan="6" class="error-row">${escapeHtml(e.message || 'No se pudo cargar el ranking.')}</td></tr>`;
    }
  }
}
