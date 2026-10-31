// Full-screen "you're in" hype sequence, played right after sign-up (and replayable from My race).
import { esc, fmtLocal } from './common.js';
import { bibHTML } from './bib.js';

const BEAT = 1650; // ms between lines; each line is on screen for about 1.8 s

/** Plays the sequence. Resolves when the runner taps through or skips. */
export function playHype({ first = '', last = '', bib, event = 'Last Legs Standing', startMs } = {}) {
  const lines = [
    `${esc(first) || 'Runner'},<br><span class="accent">you’re in.</span>`,
    `Day 1.<br><span class="accent">1 km.</span>`,
    `Then 2.<br>Then 3.<br><span class="gold">Then 30.</span>`,
    `No finish line.<small>No cap. No final day. It ends when one runner is left.</small>`,
    `Miss a day?<br><span class="accent">You’re out.</span>`,
    `One more K.<br>Every day.<br><span class="accent">Until one is left.</span>`,
    `How many days<br>do you have<br><span class="gold">in you?</span>`,
  ];
  const root = document.createElement('div');
  root.className = 'hype';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Welcome to the race');
  root.innerHTML = `
    ${Array.from({ length: 7 }, (_, i) => `<div class="streak" style="top:${8 + i * 13}%;animation-delay:${(i * 0.23).toFixed(2)}s;animation-duration:${(1 + (i % 3) * 0.35).toFixed(2)}s"></div>`).join('')}
    <button class="btn ghost sm skip-hype" type="button">Skip</button>
    ${lines.map((l) => `<div class="line" aria-hidden="true">${l}</div>`).join('')}
    <div class="line final-wrap" aria-live="polite"><div class="final">
      ${bibHTML({ event, bib: bib ?? "—", name: `${first}${last ? ` ${last[0]}.` : ""}` })}
      <h2>Welcome to the <span class="accent">start line.</span></h2>
      ${startMs ? `<p class="ink2" style="margin:0;font-size:1rem">Day 1 starts ${fmtLocal(startMs)}</p>` : ''}
      <button class="btn lg go" type="button">Let’s go</button>
    </div></div>`;
  document.body.append(root);
  document.body.style.overflow = 'hidden';

  const els = [...root.querySelectorAll('.line')];
  const timers = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  return new Promise((resolve) => {
    const finish = () => {
      timers.forEach(clearTimeout);
      root.classList.add('out');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { root.remove(); document.body.style.overflow = ''; resolve(); }, 450);
    };
    const showFinal = () => {
      timers.forEach(clearTimeout);
      els.forEach((e) => e.classList.remove('on', 'stay'));
      const f = els[els.length - 1];
      f.classList.add('on', 'stay');
      root.querySelector('.skip-hype').classList.add('hidden');
      f.querySelector('.go').focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('.skip-hype').addEventListener('click', showFinal);
    root.querySelector('.go').addEventListener('click', finish);

    if (reduced) return showFinal();
    lines.forEach((_, i) => timers.push(setTimeout(() => {
      els[i].classList.add('on', ...(i === 4 ? ['hit'] : []));
      navigator.vibrate?.(i === 4 ? [80, 60, 80] : 35);
    }, 250 + i * BEAT)));
    timers.push(setTimeout(showFinal, 250 + lines.length * BEAT));
  });
}
