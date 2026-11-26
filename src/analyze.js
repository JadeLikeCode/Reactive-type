// Reads a piece of text and returns a tone profile, an intent guess,
// a length class, and the evidence behind each — so the UI can explain itself.

import { DIMENSIONS, LEXICON, NEGATORS, INFORMAL, MARKETING, IMPERATIVE_STARTS } from './lexicon.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Soft saturation: a few hits register, many hits approach 1 without exceeding it.
const squash = (x, k = 1) => 1 - Math.exp(-k * x);

function stem(w) {
  for (const suf of ['ingly', 'ings', 'ing', 'edly', 'ed', 'ness', 'ful', 'ly', 'ies', 'es', 's']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      let base = w.slice(0, -suf.length);
      if (suf === 'ies') base += 'y';
      return base;
    }
  }
  return w;
}

export function lookup(w) {
  if (LEXICON.has(w)) return LEXICON.get(w);
  const s = stem(w);
  if (LEXICON.has(s)) return LEXICON.get(s);
  if (LEXICON.has(s + 'e')) return LEXICON.get(s + 'e');
  // doubled consonant: "sobbing" -> "sobb" -> "sob"
  if (s.length > 3 && s.at(-1) === s.at(-2) && LEXICON.has(s.slice(0, -1))) return LEXICON.get(s.slice(0, -1));
  return null;
}

export function analyze(raw) {
  const text = raw.trim();
  const tokens = text.toLowerCase().match(/[a-z']+|\d+(?:[.,]\d+)?/g) || [];
  const wordTokens = tokens.filter((t) => /[a-z]/.test(t));
  const wordCount = wordTokens.length;
  const sentences = text.split(/(?<=[.!?…])\s+|\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const lines = text.split('\n').filter((l) => l.trim());

  // ---- Lexicon pass, with simple negation ("not happy" doesn't count as joy)
  const hits = Object.fromEntries(DIMENSIONS.map((d) => [d.id, []]));
  const negated = [];
  tokens.forEach((t, i) => {
    const dim = lookup(t);
    if (!dim) return;
    const prev = [tokens[i - 1], tokens[i - 2]];
    if (prev.some((p) => p && NEGATORS.has(p)) && dim !== 'formality' && dim !== 'technical') {
      negated.push(t);
      return;
    }
    hits[dim].push(t);
  });

  // ---- Structural signals
  const count = (re) => (text.match(re) || []).length;
  const per100 = (n) => (wordCount ? (n / wordCount) * 100 : 0);
  const exclaim = count(/!/g);
  const questions = count(/\?/g);
  const ellipses = count(/\.\.\.|…/g);
  const contractions = wordTokens.filter((t) => /'(s|re|ll|ve|d|m|t)$/.test(t)).length;
  const firstPerson = wordTokens.filter((t) => ['i', 'me', 'my', "i'm", "i've", 'we', 'us', 'our'].includes(t)).length;
  const secondPerson = wordTokens.filter((t) => ['you', 'your', "you're", 'yours'].includes(t)).length;
  const thirdPerson = wordTokens.filter((t) => ['he', 'she', 'they', 'his', 'her', 'their', 'him'].includes(t)).length;
  const pastTense = wordTokens.filter((t) => /ed$/.test(t) && t.length > 4).length +
    wordTokens.filter((t) => ['was', 'were', 'had', 'said', 'went', 'came', 'saw', 'knew', 'thought', 'felt', 'took'].includes(t)).length;
  const digits = tokens.filter((t) => /^\d/.test(t)).length;
  const caps = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
  const quotes = count(/["“”]/g);
  const informal = wordTokens.filter((t) => INFORMAL.has(t)).length;
  const marketing = wordTokens.filter((t) => MARKETING.has(t)).length;
  const imperatives = sentences.filter((s) => IMPERATIVE_STARTS.has((s.toLowerCase().match(/^[\d.)\s-]*([a-z]+)/) || [])[1])).length;
  const avgWordLen = wordCount ? wordTokens.reduce((a, t) => a + t.replace(/'/g, '').length, 0) / wordCount : 0;
  const avgSentence = sentences.length ? wordCount / sentences.length : 0;
  const shortLines = lines.length >= 3 && lines.filter((l) => l.split(/\s+/).length <= 8).length / lines.length > 0.6;

  // ---- Tone profile (0..1 each). Lexicon density does most of the work;
  // structural signals nudge it.
  const density = (dim) => per100(hits[dim].length);
  const p = {};
  const K = 0.16;
  p.warmth = squash(density('warmth'), K);
  p.joy = squash(density('joy') + (hits.joy.length ? per100(exclaim) * 0.4 : 0) + per100(informal) * 0.3, K);
  p.melancholy = squash(density('melancholy') + per100(ellipses) * 1.0, K);
  p.intensity = squash(density('intensity') + per100(exclaim) * 0.9 + per100(caps) * 2, K);
  p.tension = squash(density('tension') + per100(ellipses) * 0.5 + per100(questions) * 0.3, K);
  p.wonder = squash(density('wonder') + (shortLines ? 4 : 0), K);
  p.gravity = squash(density('gravity'), K * 1.2);
  p.formality = clamp01(
    squash(density('formality'), K * 1.5) * 0.6 +
    clamp01((avgWordLen - 4.0) / 2) * 0.25 +
    clamp01((avgSentence - 12) / 18) * 0.2 -
    clamp01(per100(contractions) / 6) * 0.3 -
    clamp01(per100(informal) / 3) * 0.3
  );
  p.technical = squash(density('technical') + per100(digits) * 0.6 + per100(imperatives) * 2, K);
  for (const k in p) p[k] = Math.round(clamp01(p[k]) * 100) / 100;

  // ---- Intent: what kind of writing is this?
  const intents = {
    story: per100(pastTense) * 0.25 + per100(thirdPerson) * 0.25 + per100(quotes) * 0.2 + (wordCount > 60 ? 0.4 : 0),
    poem: (shortLines ? 1.6 : 0) + p.wonder * 0.8 + p.melancholy * 0.3,
    personal: per100(firstPerson) * 0.1 + per100(secondPerson) * 0.08 + p.warmth * 0.9 + p.joy * 0.3 + per100(contractions) * 0.05,
    formal: p.formality * 2.2,
    instructional: per100(imperatives) * 0.5 + p.technical * 1.6,
    marketing: per100(marketing) * 0.3 + (marketing ? per100(exclaim) * 0.1 + per100(secondPerson) * 0.05 : 0),
  };
  const intentRanked = Object.entries(intents).sort((a, b) => b[1] - a[1]);
  const intent = intentRanked[0][1] > 0.35 ? intentRanked[0][0] : 'general';

  // ---- Length: decides how much legibility outweighs personality
  const lengthClass = wordCount < 40 ? 'short' : wordCount < 250 ? 'medium' : 'long';
  const lengthFactor = clamp01((wordCount - 25) / 300); // 0 = tiny, 1 = long read

  return {
    text, profile: p, hits, negated, intent, intents, lengthClass, lengthFactor,
    stats: {
      words: wordCount, sentences: sentences.length,
      avgSentence: Math.round(avgSentence * 10) / 10,
      avgWordLen: Math.round(avgWordLen * 10) / 10,
      exclaim, questions, ellipses, contractions, digits, imperatives, shortLines,
    },
  };
}

// ---------------------------------------------------------------------------
// Live reading. Recent words count most (exponential decay), and the word
// still being typed is guessed from its first letters, so the type can lean
// toward where the sentence is going before the word is finished.
const LEX_WORDS = [...LEXICON.keys()];
export function lean(text, halfLife = 10) {
  const tokens = text.toLowerCase().match(/[a-z']+/g) || [];
  const typing = /[a-z']$/i.test(text);
  const n = tokens.length;
  const acc = Object.fromEntries(DIMENSIONS.map((d) => [d.id, 0]));
  let wsum = 0;
  tokens.forEach((t, i) => {
    const w = Math.pow(0.5, (n - 1 - i) / halfLife);
    wsum += w;
    if (typing && i === n - 1) return;
    const dim = lookup(t);
    if (!dim) return;
    if ([tokens[i - 1], tokens[i - 2]].some((p) => p && NEGATORS.has(p))) return;
    acc[dim] += w;
  });

  let predicted = null;
  if (typing && n) {
    const part = tokens[n - 1];
    const exact = lookup(part);
    if (exact) { acc[exact] += 1; predicted = { dim: exact, word: part, done: true }; }
    else if (part.length >= 3) {
      const counts = {}, example = {};
      for (const w of LEX_WORDS) if (w.startsWith(part)) {
        const d = LEXICON.get(w);
        counts[d] = (counts[d] || 0) + 1;
        if (!example[d] || w.length < example[d].length) example[d] = w;
      }
      // Ambiguous prefixes ("dre" → dream or dread?) are settled by the mood so far.
      const best = Object.entries(counts).map(([d, c]) => [d, Math.sqrt(c) * (1 + 4 * acc[d])]).sort((a, b) => b[1] - a[1])[0];
      if (best) { acc[best[0]] += 0.75; predicted = { dim: best[0], word: example[best[0]], done: false }; }
    }
  }

  // Punctuation and structure from the recent tail.
  const tail = text.slice(-240);
  const tailWords = Math.max(4, (tail.match(/[A-Za-z']+/g) || []).length);
  const per = (x) => (x / tailWords) * 100;
  const ex = (tail.match(/!/g) || []).length, el = (tail.match(/\.\.\.|…/g) || []).length;
  const caps = (tail.match(/\b[A-Z]{3,}\b/g) || []).length, q = (tail.match(/\?/g) || []).length;
  const dens = (d) => (acc[d] / Math.max(wsum, 1)) * 100;
  const K = 0.14;
  const recent = analyze(text.slice(-500));
  const p = {
    warmth: squash(dens('warmth'), K),
    joy: squash(dens('joy') + (acc.joy ? per(ex) * 0.5 : 0), K),
    melancholy: squash(dens('melancholy') + per(el) * 1.2, K),
    intensity: squash(dens('intensity') + per(ex) * 0.9 + per(caps) * 2.2, K),
    tension: squash(dens('tension') + per(el) * 0.6 + per(q) * 0.3, K),
    wonder: Math.max(squash(dens('wonder'), K), recent.profile.wonder * 0.8),
    gravity: squash(dens('gravity'), K * 1.2),
    formality: Math.max(squash(dens('formality'), K * 1.4), analyze(text.slice(-600)).profile.formality * 0.9),
    technical: Math.max(squash(dens('technical'), K), analyze(text.slice(-400)).profile.technical * 0.9),
  };
  for (const k in p) p[k] = Math.round(clamp01(p[k]) * 100) / 100;
  return { profile: p, predicted };
}
