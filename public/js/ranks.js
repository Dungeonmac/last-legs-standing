// Profile picture frames. A runner's rank comes from their BEST race: the most race days they've survived
// in any single race (disqualifications don't count). Award winners also get a medal ribbon, and overall
// champions a crown.
import { esc } from './common.js';

export const RANKS = [
  { min: 0, key: 'rookie', name: 'Rookie', look: 'Thin grey ring', blurb: 'No race days survived yet.' },
  { min: 1, key: 'bronze', name: 'Bronze Starter', look: 'Bronze ring', blurb: 'Survived Day 1.' },
  { min: 10, key: 'silver', name: 'Silver Strider', look: 'Double silver ring', blurb: 'Survived 10 days in one race.' },
  { min: 20, key: 'gold', name: 'Gold Grinder', look: 'Gold rounded square', blurb: 'Survived 20 days in one race.' },
  { min: 30, key: 'platinum', name: 'Platinum Pacer', look: 'Glowing platinum hexagon', blurb: 'Survived 30 days in one race.' },
  { min: 40, key: 'diamond', name: 'Diamond Distance', look: 'Shimmering ice-blue octagon', blurb: 'Survived 40 days in one race.' },
  { min: 50, key: 'legend', name: 'Legend', look: 'Burning 12-point star that spins', blurb: 'Survived 50 days in one race.' },
  { min: 60, key: 'immortal', name: 'Immortal', look: 'Twin counter-spinning halos with a pulsing aura', blurb: 'Survived 60 or more days in one race.' },
];

/** days = the most race days survived in a single race. */
export const rankFor = (days) => [...RANKS].reverse().find((r) => days >= r.min) || RANKS[0];
export const nextRank = (days) => RANKS.find((r) => r.min > days) || null;
export const rankRange = (r) => (r.min === 0 ? 'No days yet' : r.key === 'immortal' ? 'Day 60+' : r.min === 1 ? 'Day 1+' : `Day ${r.min}+`);

const ord = (n) => `${n}${['st', 'nd', 'rd'][n - 1] || 'th'}`;

/**
 * A profile picture in its rank frame.
 * award: the runner's best award { place, category, year? } (adds a ribbon; 1st Overall adds a crown).
 */
export function avatarHTML({ src, name = '', days = 0, award = null, size = 'md', rank = rankFor(days) } = {}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const champion = award && award.place === 1 && award.category === 'Overall';
  return `
    <div class="pf pf-${rank.key} pf-${size}" title="${esc(rank.name)}${award ? ` · ${ord(award.place)} ${esc(award.category)}` : ''}">
      ${champion ? '<span class="pf-crown" aria-hidden="true">👑</span>' : ''}
      ${rank.key === 'immortal' ? '<span class="pf-halo" aria-hidden="true"></span>' : ''}
      <div class="pf-frame"><div class="pf-img">${src ? `<img src="${esc(src)}" alt="">` : `<span>${esc(initials)}</span>`}</div></div>
      ${award ? `<span class="pf-ribbon p${award.place}">${ord(award.place)} · ${esc(award.category)}${award.year ? ` ${esc(award.year)}` : ''}</span>` : ''}
    </div>`;
}

/** The best award to show on the frame: highest place, then overall > men/women > age group. */
export function bestAward(awards = []) {
  const weight = (a) => a.place * 10 + (a.category === 'Overall' ? 0 : /^(Men|Women)$/.test(a.category) ? 1 : 2);
  return [...awards].sort((a, b) => weight(a) - weight(b))[0] || null;
}
