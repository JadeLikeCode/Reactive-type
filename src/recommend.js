// Scores every typeface in the pool against an analysis and explains the winner.

import { DIMENSIONS } from './lexicon.js';
import { FONTS } from './fonts.js';

export function recommend(a, pool = FONTS) {
  const p = a.profile;
  const ids = DIMENSIONS.map((d) => d.id);

  const scored = pool.map((f) => {
    // Closeness on each tone dimension, weighted by how strongly the text expresses it.
    // A dimension the text barely touches still counts a little, so a
    // calm, neutral paragraph prefers calm, neutral faces.
    let num = 0, den = 0;
    const parts = ids.map((id) => {
      const w = 0.25 + p[id] * 1.75;
      const close = 1 - Math.abs(p[id] - f.t[id]);
      num += w * close; den += w;
      return { id, w, close, contrib: w * close * p[id] };
    });
    let score = num / den;

    // Intent fit: a typeface that suits this kind of writing gets a nudge.
    const intentFit = f.intents.includes(a.intent);
    if (intentFit) score += 0.05;
    // Some faces are simply wrong for some kinds of writing, however the tone scores.
    if ((f.avoid || []).includes(a.intent)) score -= 0.12;

    // Length: long reads reward legibility; short pieces reward personality.
    const L = a.lengthFactor;
    const lengthAdj = L * 0.22 * (f.legibility - 0.8) + (1 - L) * 0.08 * (f.personality - 0.5);
    score += lengthAdj;

    return { font: f, score, parts, intentFit, lengthAdj };
  }).sort((x, y) => y.score - x.score);

  // Express scores as a match % relative to the spread of the pool, so the
  // numbers read meaningfully rather than all sitting at 80-something.
  const top = scored[0].score, bottom = scored.at(-1).score;
  for (const s of scored) s.match = Math.round(60 + 39 * ((s.score - bottom) / (top - bottom || 1)));

  const best = scored[0];
  const reasons = best.parts
    .filter((x) => p[x.id] >= 0.2)
    .sort((x, y) => y.contrib - x.contrib)
    .slice(0, 3)
    .map((x) => ({ id: x.id, label: DIMENSIONS.find((d) => d.id === x.id).label, text: p[x.id], font: best.font.t[x.id] }));

  return { ranked: scored, best, reasons, setting: setting(a, best.font) };
}

// Size, leading and measure follow from length and the face's own proportions.
export function setting(a, f) {
  const base = { short: 26, medium: 21, long: 18 }[a.lengthClass];
  const size = Math.round(base * (f.sizeBoost || 1));
  const leading = Math.round(((f.lh || 1.55) + (a.lengthClass === 'short' ? -0.1 : a.lengthClass === 'long' ? 0.05 : 0)) * 100) / 100;
  const measure = a.lengthClass === 'short' ? 32 : a.lengthClass === 'medium' ? 62 : 66;
  const weight = f.weight || 400;
  return { size, leading, measure, weight };
}
