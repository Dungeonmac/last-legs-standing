// "Runners left by day" step chart: one series, so no legend; the title names it.
// Thin 2px line, recessive grid, crosshair + tooltip on hover/touch, and a table view for accessibility.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** Round tick step (1, 2 or 5 x 10^k) giving at most 5 intervals. */
function niceStep(v) {
  const raw = Math.max(1, v) / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
}

export function survivorsChart(container, series, { title = 'Runners left after each day' } = {}) {
  container.innerHTML = '';
  container.classList.add('chart');
  if (!series.length) {
    container.innerHTML = '<p class="muted">No days completed yet.</p>';
    return;
  }
  const W = 820;
  const H = 300;
  const m = { t: 16, r: 18, b: 34, l: 46 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxDay = Math.max(1, series[series.length - 1].day);
  const yStep = niceStep(series[0].left);
  const ticks = Math.ceil(series[0].left / yStep);
  const maxY = ticks * yStep;
  const x = (d) => m.l + (d / maxDay) * iw;
  const y = (v) => m.t + ih - (v / maxY) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const last = series[series.length - 1];
  svg.setAttribute('aria-label', `${title}: started with ${series[0].left}, ${last.left} left after day ${last.day}.`);

  for (let i = 0; i <= ticks; i++) {
    const v = yStep * i;
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid-line' }));
    const t = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' });
    t.textContent = Math.round(v);
    svg.append(t);
  }
  const step = Math.max(1, Math.ceil(maxDay / 10));
  for (let d = 0; d <= maxDay; d += step) {
    const t = el('text', { x: x(d), y: H - 12, 'text-anchor': 'middle', class: 'axis-label' });
    t.textContent = d === 0 ? 'Start' : `D${d}`;
    svg.append(t);
  }

  // step-after path
  let path = `M${x(series[0].day)},${y(series[0].left)}`;
  for (let i = 1; i < series.length; i++) path += ` H${x(series[i].day)} V${y(series[i].left)}`;
  const area = `${path} V${y(0)} H${x(series[0].day)} Z`;
  svg.append(el('path', { d: area, fill: '#fc4c02', 'fill-opacity': '0.12' }));
  svg.append(el('path', { d: path, fill: 'none', stroke: '#fc4c02', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  svg.append(el('circle', { cx: x(last.day), cy: y(last.left), r: 5, fill: '#fc4c02', stroke: '#121317', 'stroke-width': 2 }));

  const cross = el('line', { y1: m.t, y2: m.t + ih, stroke: '#ecebe655', 'stroke-width': 1, visibility: 'hidden' });
  const dot = el('circle', { r: 5, fill: '#fc4c02', stroke: '#121317', 'stroke-width': 2, visibility: 'hidden' });
  svg.append(cross, dot);
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
  svg.append(hit);

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.append(svg, tip);

  const move = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left) * (W / r.width);
    const d = Math.round(((px - m.l) / iw) * maxDay);
    const pt = series.find((s) => s.day === Math.max(0, Math.min(maxDay, d)));
    if (!pt) return;
    cross.setAttribute('x1', x(pt.day)); cross.setAttribute('x2', x(pt.day));
    dot.setAttribute('cx', x(pt.day)); dot.setAttribute('cy', y(pt.left));
    cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    tip.innerHTML = pt.day === 0
      ? `<b>${pt.left}</b> runners at the start`
      : `Day ${pt.day}<br><b>${pt.left}</b> left · ${pt.out} out that day`;
    tip.style.left = `${(x(pt.day) / W) * 100}%`;
    tip.style.top = `${(y(pt.left) / H) * r.height}px`;
    tip.style.opacity = 1;
  };
  const leave = () => {
    tip.style.opacity = 0;
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('touchmove', move, { passive: true });
  hit.addEventListener('mouseleave', leave);

  const toggle = document.createElement('button');
  toggle.className = 'chart-toggle';
  toggle.textContent = 'Show as table';
  const table = document.createElement('div');
  table.className = 'table-wrap hidden';
  table.style.maxHeight = '300px';
  table.innerHTML = `<table><thead><tr><th>Day</th><th class="r">Eliminated</th><th class="r">Runners left</th></tr></thead><tbody>${
    series.map((s) => `<tr><td>${s.day === 0 ? 'Start' : s.day}</td><td class="r">${s.day === 0 ? '–' : s.out}</td><td class="r">${s.left}</td></tr>`).join('')
  }</tbody></table>`;
  toggle.addEventListener('click', () => {
    const show = table.classList.toggle('hidden');
    wrap.classList.toggle('hidden', !show);
    toggle.textContent = show ? 'Show as table' : 'Show as chart';
  });

  container.append(wrap, table, toggle);
}
