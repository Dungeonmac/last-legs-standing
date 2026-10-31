// The race bib shown on My race and in the welcome animation: site logo, event name, number, runner.
import { esc } from './common.js';

export function bibHTML({ event = 'Last Legs Standing', bib = '—', name = '', division = '' } = {}) {
  return `
    <div class="race-bib" role="img" aria-label="Race bib ${esc(bib)}, ${esc(event)}">
      <span class="rb-pin tl"></span><span class="rb-pin tr"></span><span class="rb-pin bl"></span><span class="rb-pin br"></span>
      <div class="rb-top"><img src="/img/logo-mark.svg" alt=""><span>Last Legs<b>Standing</b></span></div>
      <div class="rb-event">${esc(event)}</div>
      <div class="rb-no">${esc(bib)}</div>
      <div class="rb-name">${esc(name)}</div>
      <div class="rb-bottom"><span>${esc(division || 'Runner')}</span><span>+1 km · every day</span></div>
    </div>`;
}
