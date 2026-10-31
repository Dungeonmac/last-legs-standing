// Profile picture frames. The frame levels up with every race a runner competes in (races that have started,
// disqualifications not counted). Award winners also get a medal ribbon, and overall champions a crown.
import { esc } from './common.js';

export const RANKS = [
  { min: 0, key: 'rookie', name: 'Rookie', look: 'Thin grey ring', blurb: 'Account made. Your first race is ahead of you.' },
  { min: 1, key: 'bronze', name: 'Bronze Starter', look: 'Bronze ring', blurb: 'Competed in 1 race.' },
  { min: 2, key: 'silver', name: 'Silver Strider', look: 'Double silver ring', blurb: 'Competed in 2 races.' },
  { min: 3, key: 'gold', name: 'Gold Grinder', look: 'Gold rounded square', blurb: 'Competed in 3 races.' },
  { min: 5, key: 'platinum', name: 'Platinum Pacer', look: 'Glowing platinum hexagon', blurb: 'Competed in 5 races.' },
  { min: 8, key: 'diamond', name: 'Diamond Distance', look: 'Shimmering ice-blue octagon', blurb: 'Competed in 8 races.' },
  { min: 12, key: 'legend', name: 'Legend', look: 'Burning 12-point star that spins', blurb: 'Competed in 12 or more races.' },
];

export const rankFor = (events) => [...RANKS].reverse().find((r) => events >= r.min) || RANKS[0];
export const nextRank = (events) => RANKS.find((r) => r.min > events) || null;

const ord = (n) => `${n}${['st', 'nd', 'rd'][n - 1] || 'th'}`;

/**
 * A profile picture in its rank frame.
 * award: the runner's best award { place, category, year? } (adds a ribbon; 1st Overall adds a crown).
 */
export function avatarHTML({ src, name = '', events = 0, award = null, size = 'md', rank = rankFor(events) } = {}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const champion = award && award.place === 1 && award.category === 'Overall';
  return `
    <div class="pf pf-${rank.key} pf-${size}" title="${esc(rank.name)}${award ? ` · ${ord(award.place)} ${esc(award.category)}` : ''}">
      ${champion ? '<span class="pf-crown" aria-hidden="true">👑</span>' : ''}
      <div class="pf-frame"><div class="pf-img">${src ? `<img src="${esc(src)}" alt="">` : `<span>${esc(initials)}</span>`}</div></div>
      ${award ? `<span class="pf-ribbon p${award.place}">${ord(award.place)} · ${esc(award.category)}${award.year ? ` ${esc(award.year)}` : ''}</span>` : ''}
    </div>`;
}

/** The best award to show on the frame: highest place, then overall > men/women > age group. */
export function bestAward(awards = []) {
  const weight = (a) => a.place * 10 + (a.category === 'Overall' ? 0 : /^(Men|Women)$/.test(a.category) ? 1 : 2);
  return [...awards].sort((a, b) => weight(a) - weight(b))[0] || null;
}
