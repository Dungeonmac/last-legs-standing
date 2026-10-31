// Shared site chrome + helpers. Every page loads this as a module.

export const SITE = 'Last Legs Standing';
export const KM_PER_MI = 1.609344;
// Help desk contact. help@lastlegstanding.com forwards to the team inbox (Cloudflare Email Routing).
// The phone number is a placeholder (555-01xx numbers are reserved for fiction) until a real line is set up.
export const SUPPORT = { email: 'help@lastlegstanding.com', phone: '(212) 555-0147', phoneHref: 'tel:+12125550147' };

// ---------------------------------------------------------------- admin demo mode
// Admins can switch on Demo mode to see the site with the sample races and runners (hidden from the public),
// optionally viewing it as one of the demo runners. The server ignores these headers for non-admins.
export const DEMO_AS = { paid: 'Jordan (paid, race not started)', runner: 'Test Runner (in the race, Day 18)' };
export const demoOn = () => localStorage.getItem('lls-demo') === '1';
export function demoHeaders() {
  if (!demoOn()) return {};
  const as = localStorage.getItem('lls-demo-as');
  return { 'x-lls-demo': '1', ...(DEMO_AS[as] ? { 'x-lls-demo-as': as } : {}) };
}
export function setDemo(on, as = null) {
  if (on) localStorage.setItem('lls-demo', '1'); else localStorage.removeItem('lls-demo');
  if (as) localStorage.setItem('lls-demo-as', as); else localStorage.removeItem('lls-demo-as');
}

// ---------------------------------------------------------------- API
export async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts, headers: { ...demoHeaders(), ...(opts.headers || {}) } };
  if (opts.json !== undefined) {
    init.method = init.method || 'POST';
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(`/api${path}`, init);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok && !opts.allowError) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return opts.allowError ? { ok: res.ok, status: res.status, data } : data;
}

let mePromise;
export const getMe = () => (mePromise ||= api('/me').catch(() => ({ user: null })));

export async function requireLogin() {
  const me = await getMe();
  if (!me.user) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {});
  }
  return me;
}

// ---------------------------------------------------------------- units & formatting
export const getUnits = () => localStorage.getItem('lls-units') || 'km';
export function setUnits(u) {
  localStorage.setItem('lls-units', u);
  document.querySelectorAll('.units button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.u === u)));
  window.dispatchEvent(new CustomEvent('units', { detail: u }));
}

export function dist(m, digits = 1, units = getUnits()) {
  const v = units === 'mi' ? m / 1000 / KM_PER_MI : m / 1000;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units}`;
}
// Miles never get rounded to whole numbers (18 km is 11.2 mi, not "11 mi").
export const both = (m, digits = 1) => `${dist(m, digits, 'km')} / ${dist(m, Math.max(1, digits), 'mi')}`;

export function pace(movingS, meters, units = getUnits()) {
  if (!meters || !movingS) return '–';
  const per = units === 'mi' ? (movingS / meters) * 1000 * KM_PER_MI : (movingS / meters) * 1000;
  const m = Math.floor(per / 60);
  const s = Math.round(per % 60);
  return `${m}:${String(s).padStart(2, '0')} /${units}`;
}

export function duration(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export const fmtUTC = (ms, withDate = true) =>
  new Date(ms).toLocaleString(undefined, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', ...(withDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}) }) + ' UTC';
export const fmtLocal = (ms, withDate = true) =>
  new Date(ms).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', ...(withDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}) });
export const fmtDate = (ms, tz) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', ...(tz ? { timeZone: tz } : {}) });
export const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function toast(msg, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------------------------------------------------------- countdown
/** Renders a live countdown into `el`. serverNow corrects for a wrong device clock. */
export function countdown(el, targetMs, { serverNow, onDone, small, urgentUnderMs = 3 * 3600_000 } = {}) {
  const skew = serverNow ? serverNow - Date.now() : 0;
  el.classList.add('countdown');
  if (small) el.classList.add('sm');
  el.setAttribute('role', 'timer');
  const tick = () => {
    const left = Math.max(0, targetMs - (Date.now() + skew));
    const d = Math.floor(left / 86_400_000);
    const h = Math.floor((left % 86_400_000) / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    const units = d > 0 ? [[d, 'days'], [h, 'hrs'], [m, 'min'], [s, 'sec']] : [[h, 'hrs'], [m, 'min'], [s, 'sec']];
    el.innerHTML = units.map(([v, l]) => `<div class="unit"><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
    el.classList.toggle('urgent', left < urgentUnderMs);
    el.setAttribute('aria-label', `${d} days ${h} hours ${m} minutes left`);
    if (left === 0) { clearInterval(id); onDone?.(); }
  };
  const id = setInterval(tick, 1000);
  tick();
  return () => clearInterval(id);
}

// ---------------------------------------------------------------- chrome
const NAV = [
  ['/', 'Home', 'home'],
  ['/#about', 'How it works', 'about'],
  ['/#rules', 'Rules', 'rules'],
  ['/events.html', 'Events', 'events'],
  ['/live.html', 'Live', 'live'],
  ['/help.html', 'Help', 'help'],
];

// Bottom tab bar for logged-in runners on phones.
const TABS = [
  ['/account.html', 'My race', 'account', '<path d="M4 20V10l8-6 8 6v10h-5v-6H9v6z"/>'],
  ['/upload.html', 'Upload', 'upload', '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"/>'],
  ['/track.html', 'Tracker', 'track', '<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/>'],
  ['/how-to-submit.html', 'How to', 'guide', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3v.01"/>'],
];

// Race sign-up links show only when registration is open (or for an admin previewing in demo mode).
// ...and never once the runner is already signed up for an upcoming race.
export const signedUpFor = (me, slug) => (me.registrations || []).some((r) => r.slug === slug && r.event_status === 'upcoming');
const signedUpAny = (me) => (me.registrations || []).some((r) => r.event_status === 'upcoming');
const showSignup = (me) => !signedUpAny(me) && (!!me.raceSignupOpen || (!!me.user?.isAdmin && demoOn()));

function header(page, me) {
  const u = getUnits();
  const links = NAV.map(([href, label, key]) =>
    `<a href="${href}" ${key === page ? 'aria-current="page"' : ''} ${key === 'live' ? 'data-live-link' : ''}>${label}</a>`).join('');
  const account = me.user
    ? `<a class="menu-only" href="/upload.html" ${page === 'upload' ? 'aria-current="page"' : ''}>Upload run</a>
       <a class="menu-only" href="/track.html" ${page === 'track' ? 'aria-current="page"' : ''}>Tracker</a>
       ${me.user.isAdmin ? `<a href="/admin.html" ${page === 'admin' ? 'aria-current="page"' : ''}>Admin</a>` : ''}
       <a href="/profile.html" ${page === 'profile' ? 'aria-current="page"' : ''}>Profile</a>`
    : me.accountsOpen === false ? '' : `<a href="/login.html">Log in</a>`;
  return `
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="/" aria-label="${SITE} home">
        <img src="/img/logo-mark.svg" alt="" width="34" height="34">
        <span class="brand-word">Last Legs<span>Standing</span></span>
      </a>
      ${me.user ? `<a class="my-race-btn" href="/account.html" ${page === 'account' ? 'aria-current="page"' : ''}>
        ${me.user.avatar ? `<img src="${me.user.avatar}" alt="" width="26" height="26">` : `<span class="mr-initial" aria-hidden="true">${esc((me.user.first_name || '?')[0])}</span>`}My race</a>` : ''}
      <a class="live-pill hidden" href="/live.html" data-live-pill>Live</a>
      <button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
      <nav class="nav" id="nav" aria-label="Main">
        ${links}
        <div class="nav-actions">
          ${account}
          ${showSignup(me) ? '<a href="/signup.html" class="btn sm">Sign up</a>' : ''}
          <div class="units" role="group" aria-label="Distance units">
            <button data-u="km" aria-pressed="${u === 'km'}">KM</button><button data-u="mi" aria-pressed="${u === 'mi'}">MI</button>
          </div>
        </div>
      </nav>
    </div>
  </header>`;
}

function footer(me) {
  const y = new Date().getFullYear();
  return `
  <footer class="site-footer">
    <div class="wrap">
      <div class="cols">
        <div>
          <a class="brand" href="/"><img src="/img/logo-mark.svg" alt="" width="34" height="34"><span class="brand-word">Last Legs<span>Standing</span></span></a>
          <p class="small" style="margin-top:1rem;max-width:36ch">One more kilometer, every day, anywhere on Earth, until only one runner is left.</p>
        </div>
        <div><h4>Race</h4><ul>
          <li><a href="/#about">How it works</a></li><li><a href="/#rules">Rules</a></li>
          <li><a href="/events.html">Events</a></li><li><a href="/live.html">Live race</a></li></ul></div>
        <div><h4>Runners</h4><ul>
          ${showSignup(me) ? '<li><a href="/signup.html">Sign up</a></li>' : ''}${me.accountsOpen === false ? '' : '<li><a href="/login.html">Log in</a></li>'}
          <li><a href="/upload.html">Upload a run</a></li><li><a href="/track.html">Run tracker</a></li>
          <li><a href="/how-to-submit.html">How to submit a run</a></li></ul></div>
        <div><h4>Help &amp; legal</h4><ul>
          <li><a href="/help.html">Help desk &amp; contact</a></li>
          <li><a href="/waiver.html">Waiver &amp; release</a></li><li><a href="/privacy.html">Privacy</a></li>
          <li><a href="/#faq">FAQ</a></li></ul></div>
      </div>
      <div class="credits">
        © ${y} ${SITE}. All rights reserved.<br>
        Photos: “Uphill” by Don McCullough (<a href="https://commons.wikimedia.org/wiki/File:Uphill_-_Explored_-_Flickr_-_Don_McCullough.jpg" rel="noopener">CC BY 2.0</a>);
        “Mountain Runner on Becca d'Aver” by Rollopack (<a href="https://commons.wikimedia.org/wiki/File:Mountain_Runner_on_Becca_d%27Aver.jpg" rel="noopener">CC BY-SA 4.0</a>).
        Map data © OpenStreetMap contributors.
      </div>
    </div>
  </footer>`;
}

export async function mountChrome() {
  const page = document.body.dataset.page;
  const me = await getMe();
  if (!me.user?.isAdmin && demoOn()) setDemo(false); // demo mode is admin-only
  document.body.insertAdjacentHTML('afterbegin', header(page, me));
  if (me.user?.isAdmin && demoOn()) {
    const as = localStorage.getItem('lls-demo-as') || '';
    document.querySelector('.site-header').insertAdjacentHTML('afterend', `
      <div class="demo-mode-bar" role="status">
        <b>Demo mode</b><span>You're seeing sample races and runners. Only admins see this.</span>
        <label>View as <select id="demo-as">
          <option value="">Myself</option>${Object.entries(DEMO_AS).map(([k, v]) => `<option value="${k}" ${k === as ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
        <button type="button" class="btn ghost sm" id="demo-off">Turn off</button>
      </div>`);
    document.getElementById('demo-as').addEventListener('change', (e) => { setDemo(true, e.target.value || null); location.reload(); });
    document.getElementById('demo-off').addEventListener('click', () => { setDemo(false); location.reload(); });
  }
  document.body.insertAdjacentHTML('beforeend', footer(me));
  if (me.user) {
    document.body.classList.add('has-tabbar');
    document.body.insertAdjacentHTML('beforeend', `<nav class="tabbar" aria-label="Runner">${TABS.map(([href, label, key, icon]) =>
      `<a href="${href}" ${key === page ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label}</a>`).join('')}</nav>`);
  }
  const btn = document.querySelector('.menu-btn');
  const nav = document.getElementById('nav');
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.units button').forEach((b) => b.addEventListener('click', () => setUnits(b.dataset.u)));
  api('/live').then((l) => {
    if (!l.live) return;
    document.querySelector('.nav [data-live-link]')?.classList.add('live-dot');
    document.querySelector('[data-live-pill]')?.classList.remove('hidden');
  }).catch(() => {});
  return me;
}
