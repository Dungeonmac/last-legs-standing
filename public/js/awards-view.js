// Renders award categories (from the API's `awards` / `category_leaders`) as a grid of small podium cards.
import { esc, dist } from './common.js';
import { AWARD_DEPTH } from './divisions.js';

export function awardsHTML(categories, { days, live = false } = {}) {
  const lasted = (w) => (w.status === 'active' ? (live ? 'still standing' : `all ${days} days`) : w.status === 'disqualified' ? 'DQ' : `out Day ${w.eliminated_day}`);
  const card = (c) => `
    <div class="award-card ${c.key === 'overall' ? 'overall' : ''}">
      <h4>${esc(c.title)}</h4>
      <ol>${Array.from({ length: AWARD_DEPTH }, (_, i) => {
        const w = c.winners[i];
        return w
          ? `<li><span class="place p${i + 1}">${i + 1}</span><div><b>${esc(w.name)}</b> <span class="muted small">${esc(w.country || '')}</span>
               <div class="small muted">${dist(w.distance_m, 0)} · ${lasted(w)}</div></div></li>`
          : `<li class="empty-slot"><span class="place">${i + 1}</span><div class="small muted">—</div></li>`;
      }).join('')}</ol>
    </div>`;
  const [overall, ...rest] = categories;
  return `
    <div class="award-grid">${overall ? card(overall) : ''}${rest.slice(0, 2).map(card).join('')}</div>
    ${rest.length > 2 ? `<h3 style="margin:2rem 0 1rem">Age groups</h3><div class="award-grid">${rest.slice(2).map(card).join('')}</div>` : ''}`;
}
