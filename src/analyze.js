// Reads a piece of text and returns a tone profile, an intent guess,
// a length class, and the evidence behind each — so the UI can explain itself.

import { DIMENSIONS, LEXICON, NEGATORS, INFORMAL, MARKETING, IMPERATIVE_STARTS } from './lexicon.js';
import { VALENCE } from './valence.js';

// Words that turn a message around: what came before counts for less.
const TURNS = new Set(['but', 'however', 'nevermind', 'although', 'though', 'yet', 'except', 'instead', 'actually', 'jk']);
// Family words say who a message is for, not how it feels: half weight.
const KIN = new Set(['mother', 'mom', 'mum', 'father', 'dad', 'family', 'grandma', 'grandmother', 'grandpa', 'baby', 'friend']);

// A few words VADER leaves out or underweights.
const EXTRA = { died: -2.6, dead: -2.6, dying: -2.6, funeral: -2.2, buried: -1.8, passed: 0, killed: -3 };
function valenceOf(w) {
  if (w in EXTRA) return EXTRA[w];
  if (w in VALENCE) return VALENCE[w];
  const s = stem(w);
  if (s in VALENCE) return VALENCE[s];
  if (s + 'e' in VALENCE) return VALENCE[s + 'e'];
  return 0;
}
// Contempt and hostility read as intensity; other negative words read as hurt.
const HOSTILE = new Set(['disgusting', 'pathetic', 'horrible', 'hate', 'stupid', 'idiot', 'idiotic', 'ugly', 'worst', 'ridiculous',
  'outrageous', 'gross', 'trash', 'garbage', 'damn', 'hell', 'shit', 'fuck', 'fucking', 'bullshit', 'crap', 'screw', 'ruined', 'ruin',
  'useless', 'liar', 'cruel', 'despise', 'loathe', 'sucks', 'awful', 'terrible', 'nasty', 'jerk', 'dumb', 'insulting', 'shameful']);
// Phrases whose words say the opposite of what they mean.
const PHRASES = [
  [/\bthanks? for nothing\b/g, 'intensity'], [/\byeah,? right\b/g, 'intensity'], [/\bwhatever\b/g, 'intensity'],
  [/\b(can'?t|cannot) (do|take) (this|it) any ?more\b/g, 'melancholy'], [/\bi give up\b/g, 'melancholy'],
  [/\bover it\b/g, 'intensity'], [/\bfed up\b/g, 'intensity'],
];
function dimForValence(v, t, tokens, i) {
  if (v >= 2.3) return 'joy';
  if (v > 0) return 'warmth';
  const aimed = tokens.slice(Math.max(0, i - 4), i).some((x) => x === 'you' || x === 'your' || x === "you're");
  return HOSTILE.has(t) || (v <= -2.4 && aimed) ? 'intensity' : 'melancholy';
}

// One pass over the words. weightAt(i) lets callers favour recent words or the ending.
function readTokens(tokens, weightAt, skipLast = false) {
  const acc = Object.fromEntries(DIMENSIONS.map((d) => [d.id, 0]));
  const hits = Object.fromEntries(DIMENSIONS.map((d) => [d.id, []]));
  const negated = [];
  let pos = 0, neg = 0, wsum = 0;
  const turnsAfter = new Array(tokens.length).fill(0);
  for (let i = tokens.length - 1, t = 0; i >= 0; i--) {
    turnsAfter[i] = t;
    if (TURNS.has(tokens[i]) || (tokens[i] === 'kidding' && tokens[i - 1] === 'just')) t++;
  }
  tokens.forEach((t, i) => {
    const w = weightAt(i) * 0.45 ** turnsAfter[i];
    wsum += w;
    if (skipLast && i === tokens.length - 1) return;
    const negatedHere = [tokens[i - 1], tokens[i - 2]].some((p) => p && NEGATORS.has(p));
    const dim = lookup(t);
    let v = valenceOf(t);
    if (negatedHere) v = -v * 0.7;
    if (v > 0) pos += w * v * v; else if (v < 0) neg += w * v * v;
    // Strength: "furious" counts more than "annoyed"; plain lexicon words sit in between.
    const strength = v ? 0.5 + Math.min(4, Math.abs(v)) / 5 : 0.75;
    if (dim) {
      if (negatedHere && dim !== 'formality' && dim !== 'technical') {
        negated.push(t);
        // "not happy" isn't neutral: it reads as a little low.
        if (dim === 'joy' || dim === 'warmth') { acc.melancholy += w * 0.6; hits.melancholy.push(`not ${t}`); }
        return;
      }
      acc[dim] += w * strength * (KIN.has(t) ? 0.5 : 1);
      hits[dim].push(t);
    } else if (Math.abs(v) >= 1.5) {
      const d = dimForValence(v, t, tokens, i);
      acc[d] += w * strength;
      hits[d].push(negatedHere ? `not ${t}` : t);
    }
  });
  // Phrases override their words: "thanks for nothing" is not gratitude.
  const joined = tokens.join(' ');
  for (const [re, d] of PHRASES) for (const m of joined.matchAll(re)) {
    const i = joined.slice(0, m.index).split(' ').length - 1;
    const w = weightAt(Math.max(0, i)) * 0.45 ** (turnsAfter[i] || 0);
    acc[d] += w * 1.4; hits[d].push(m[0]); neg += w * 6;
    if (/thank/.test(m[0])) { acc.warmth = Math.max(0, acc.warmth - w); }
  }
  // Overall direction, -1 (hostile, bleak) to +1 (glowing). Strong words dominate.
  const valence = (pos - neg) / (pos + neg + 1);
  return { acc, hits, negated, valence, wsum };
}

// A clearly negative message can't read as warm or joyful, and vice versa.
function balance(p, valence) {
  if (valence < -0.12) { const f = Math.max(0.1, 1 + valence * 1.3); p.warmth *= f; p.joy *= f; }
  if (valence > 0.12) { const f = 1 - valence * 0.7; p.melancholy *= f; p.intensity *= f; p.tension *= 1 - valence * 0.5; }
}

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

  // ---- Word pass: tone lexicon + valence, negation, turns; the ending counts most.
  const nT = tokens.length;
  const read = readTokens(tokens, (i) => 0.6 + 0.8 * (nT > 1 ? i / (nT - 1) : 1));
  const { hits, negated } = read;
  const scale = wordCount / Math.max(read.wsum, 1);
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
  const density = (dim) => per100(read.acc[dim] * scale);
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
  balance(p, read.valence);
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
    text, profile: p, hits, negated, valence: read.valence, intent, intents, lengthClass, lengthFactor,
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
  // The sentence you're on (or just finished) speaks loudest: "...a golden frog. The frog died."
  const sentences = text.split(/(?<=[.!?…])\s+/).filter((x) => /[a-z]/i.test(x));
  const lastCount = (sentences.at(-1)?.toLowerCase().match(/[a-z']+/g) || []).length;
  const read = readTokens(tokens, (i) => Math.pow(0.5, (n - 1 - i) / halfLife) * (i >= n - lastCount ? 1.8 : 1), typing);
  const { acc, wsum } = read;

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
  const K = 0.045;
  const recent = analyze(text.slice(-500));
  const p = {
    warmth: squash(dens('warmth'), K),
    joy: squash(dens('joy') + (acc.joy ? per(ex) * 0.6 : 0), K),
    melancholy: squash(dens('melancholy') + per(el) * 1.2, K),
    intensity: squash(dens('intensity') + per(ex) * 0.8 + per(caps) * 2.4, K),
    tension: squash(dens('tension') + per(el) * 0.6 + per(q) * 0.3, K),
    wonder: Math.max(squash(dens('wonder'), K), recent.profile.wonder * 0.8),
    gravity: squash(dens('gravity'), K * 1.1),
    formality: Math.max(squash(dens('formality'), K * 1.3), analyze(text.slice(-600)).profile.formality * 0.9),
    technical: Math.max(squash(dens('technical'), K), analyze(text.slice(-400)).profile.technical * 0.9),
  };
  balance(p, read.valence);
  for (const k in p) p[k] = Math.round(clamp01(p[k]) * 100) / 100;
  return { profile: p, predicted, valence: read.valence };
}
