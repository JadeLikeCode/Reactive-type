// Reactive Type
// Two speeds: a fast local reading reacts on every keystroke;
// Enter asks Claude (or the offline rules) for a considered reading.

import { analyze, lean } from './analyze.js';
import { recommend, setting } from './recommend.js';
import { DIMENSIONS } from './lexicon.js';
import { FONTS } from './fonts.js';
import { WORKER_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const root = document.documentElement.style;
const body = document.body;
const input = $('input');

const INTENT_LABEL = {
  story: 'narrative', poem: 'lyrical', personal: 'personal message', formal: 'formal writing',
  instructional: 'instructions', marketing: 'promotional copy', general: 'general prose',
};

// ---------------------------------------------------------------- mood fields
// Each tone owns a field: a base colour and three glows. The live field is a
// weighted blend of all of them, so the background drifts as the tone drifts.
const FIELDS = {
  //           base         glows                                   accent     grid  glow
  neutral:    { base: '#0f1013', g: ['#2a2f3b', '#1a2526', '#221e2b'], accent: '#9ad0ff', grid: .08, glow: .55 },
  warmth:     { base: '#3a1408', g: ['#ff5a1f', '#ffb36b', '#d4380d'], accent: '#ffd2a8', grid: .03, glow: .95 },
  joy:        { base: '#ffe7a3', g: ['#ffcc00', '#ff5fb4', '#4fd8ff'], accent: '#c2185b', grid: .05, glow: 1 },
  melancholy: { base: '#070d1c', g: ['#2b4c86', '#5c6f93', '#14213d'], accent: '#a9c1e8', grid: .04, glow: .7 },
  intensity:  { base: '#2b0000', g: ['#ff1a0d', '#ff7a00', '#a30000'], accent: '#ffe066', grid: .1, glow: 1 },
  tension:    { base: '#020302', g: ['#0f5c32', '#071a10', '#3d0f12'], accent: '#5cff8f', grid: .14, glow: .6 },
  wonder:     { base: '#0a0628', g: ['#7a4dff', '#2ad4ff', '#ff6fd8'], accent: '#d4c7ff', grid: .04, glow: .95 },
  gravity:    { base: '#140f08', g: ['#7d6438', '#2e271c', '#4f3b1d'], accent: '#e6d3a3', grid: .06, glow: .65 },
  formality:  { base: '#f1efe9', g: ['#d6d3ca', '#b8bfcc', '#e8e1d0'], accent: '#22308c', grid: .1, glow: .6 },
  technical:  { base: '#02070b', g: ['#00c2ff', '#1f4dff', '#003b4f'], accent: '#00f0ff', grid: .2, glow: .85 },
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(clamp01(gam(c)) * 255).toString(16).padStart(2, '0')).join('');
function mix(cols, ws) {
  const out = [0, 0, 0];
  cols.forEach((c, i) => hex(c).forEach((v, j) => { out[j] += lin(v) * ws[i]; }));
  return out;
}

function applyField(tone) {
  const keys = Object.keys(FIELDS);
  // Cubed weights: the dominant mood takes over the screen instead of averaging to mud.
  const raw = keys.map((k) => (k === 'neutral' ? 0.035 : clamp01(tone?.[k]) ** 3));
  const sum = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((x) => x / sum);
  const base = mix(keys.map((k) => FIELDS[k].base), w);
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  root.setProperty('--base', toHex(base));
  root.setProperty('--ink', lum > 0.3 ? '#141416' : '#f3f1ec');
  [0, 1, 2].forEach((i) => root.setProperty(`--g${i + 1}`, toHex(mix(keys.map((k) => FIELDS[k].g[i]), w))));
  const top = keys[w.indexOf(Math.max(...w))];
  root.setProperty('--accent', FIELDS[top].accent);
  root.setProperty('--grid-a', keys.reduce((a, k, i) => a + FIELDS[k].grid * w[i], 0).toFixed(3));
  root.setProperty('--glow-a', keys.reduce((a, k, i) => a + FIELDS[k].glow * w[i], 0).toFixed(3));
}

// Between face swaps, the type keeps moving: weight and spacing follow the tone.
function applyExpression(tone, baseWeight = 400) {
  const t = (k) => clamp01(tone?.[k]);
  const weight = Math.round((baseWeight + t('intensity') * 260 + t('joy') * 60 - t('melancholy') * 90 - t('wonder') * 50) / 10) * 10;
  const track = (t('wonder') * 0.035 + t('formality') * 0.01 + t('melancholy') * 0.01 - t('intensity') * 0.02 - t('tension') * 0.015).toFixed(3);
  root.setProperty('--weight', Math.max(250, Math.min(800, weight)));
  root.setProperty('--track', `${track}em`);
}

// ---------------------------------------------------------------- fonts
let POOL = [];
const poolReady = fetch('pool.json').then((r) => r.json()).then((p) => { POOL = p; }).catch(() => {});
const loaded = new Map();
function loadFont(f) {
  if (loaded.has(f.name)) return loaded.get(f.name);
  const n = f.name.replace(/ /g, '+');
  const tries = [`${n}:wght@300..800`, f.q, `${n}:ital,wght@0,400;0,700;1,400`, `${n}:wght@400;700`, n].filter(Boolean);
  const attempt = (i) => new Promise((resolve) => {
    if (i >= tries.length) return resolve(false);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${tries[i]}&display=swap`;
    link.onload = () => document.fonts.load(`400 24px "${f.name}"`).then(() => resolve(true), () => resolve(true));
    link.onerror = () => { link.remove(); attempt(i + 1).then(resolve); };
    document.head.appendChild(link);
  });
  const p = Promise.race([attempt(0), new Promise((r) => setTimeout(() => r(true), 3500))]);
  loaded.set(f.name, p);
  return p;
}
const stack = (f) => `"${f.name}", ${/mono|typewriter/i.test(f.cls) ? 'ui-monospace, monospace' : /sans|grotesque|grotesk|gothic|geometric/i.test(f.cls) ? 'system-ui, sans-serif' : /hand/i.test(f.cls) ? 'cursive' : 'Georgia, serif'}`;
const lower = (s) => s.toLowerCase();

function applyFace(f, set) {
  root.setProperty('--face', f ? stack(f) : 'var(--mono)');
  root.setProperty('--fvs', f?.fvs || 'normal');
  baseWeight = set?.weight || f?.weight || 400;
  $('face-name').textContent = f ? lower(f.name) : 'departure mono';
  $('face-class').textContent = f ? `/ ${lower(f.cls)}` : '/ waiting for tone';
}

// Size and measure follow length; the writing never gets cramped.
function applyScale(words) {
  const size = words < 12 ? 'clamp(30px, 4.6vw, 60px)' : words < 40 ? 'clamp(26px, 3.4vw, 46px)'
    : words < 120 ? 'clamp(21px, 2.3vw, 32px)' : 'clamp(18px, 1.6vw, 22px)';
  const measure = words < 12 ? '18ch' : words < 40 ? '24ch' : words < 120 ? '34ch' : '62ch';
  root.setProperty('--size', size);
  root.setProperty('--measure', measure);
  root.setProperty('--lead', words < 40 ? 1.18 : words < 120 ? 1.35 : 1.6);
}

// ---------------------------------------------------------------- meters
function renderMeters(tone, hot = [], leaning = null) {
  $('meters').innerHTML = DIMENSIONS.map((d) => {
    const v = clamp01(tone?.[d.id]);
    const n = Math.round(v * 10);
    return `<div class="meter${hot.includes(d.id) ? ' hot' : ''}${leaning === d.id ? ' lean' : ''}" title="${esc(d.hint)}"><span>${esc(lower(d.label))}</span><span class="bar">${'▮'.repeat(n)}${'▯'.repeat(10 - n)}</span><span class="v">${String(Math.round(v * 100)).padStart(2, '0')}</span></div>`;
  }).join('');
}
const hotOf = (tone) => Object.entries(tone).filter(([, v]) => v >= 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);

// ---------------------------------------------------------------- live reaction
let current = null, baseWeight = 400, lastSwap = 0, frame = 0;
function grow() { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; }

function live() {
  frame = 0;
  const text = input.value;
  const words = (text.match(/[A-Za-z']+/g) || []).length;
  applyScale(words);
  grow();
  try { localStorage.setItem('reactive-draft', text); } catch {}
  if (words < 2) {
    applyField(null); applyExpression(null); renderMeters({}); swapFace(null);
    status(words ? 'keep going…' : 'listening'); return;
  }
  const L = lean(text);
  const full = analyze(text);
  const r = recommend({ ...full, profile: L.profile });
  applyField(L.profile);
  renderMeters(L.profile, hotOf(L.profile), L.predicted?.dim);
  const lean_ = L.predicted && !L.predicted.done ? ` · leaning → ${lower(DIMENSIONS.find((d) => d.id === L.predicted.dim).label)} (${L.predicted.word}?)` : '';
  status(`${words} words · ${INTENT_LABEL[full.intent]}${lean_}`);
  const quiet = Math.max(...Object.values(L.profile)) < 0.12;
  const best = quiet && words < 6 ? null : r.best;
  applyExpression(L.profile, best ? (best.font.weight || 400) : 400);
  if (!best) { swapFace(null); return; }
  if (current && best.font.name !== current.name) {
    // Hysteresis plus a short cooldown: decisive, but never flickering.
    const cur = r.ranked.find((x) => x.font.name === current.name);
    if (cur && best.score - cur.score < 0.02) return;
    if (performance.now() - lastSwap < 280) { setTimeout(schedule, 300); return; }
  }
  swapFace(best.font, setting(full, best.font));
}
function schedule() { if (!frame) frame = requestAnimationFrame(live); }

let swapId = 0, pending = null;
async function swapFace(f) {
  const name = f?.name || null;
  if (name === (current?.name || null)) { if (pending) { pending = null; swapId++; } return; }
  if (name === pending) return; // already on its way; don't restart the load
  pending = name;
  const id = ++swapId;
  if (f) await loadFont(f);
  if (id !== swapId) return;
  pending = null;
  lastSwap = performance.now();
  input.classList.add('swap');
  setTimeout(() => {
    if (id !== swapId) return;
    current = f;
    applyFace(f);
    grow();
    requestAnimationFrame(() => input.classList.remove('swap'));
  }, 90);
}

// ---------------------------------------------------------------- the considered reading
let readId = 0;
async function settle() {
  const text = input.value;
  if ((text.match(/[A-Za-z']+/g) || []).length < 3) { status('write a sentence first'); return; }
  const id = ++readId;
  const a = analyze(text);
  show(fromRules(a, ''), text);             // instant
  if (!WORKER_URL) return;
  status('read by rules · claude is refining…');
  try {
    await poolReady;
    const v = await fromClaude(text, a);
    await loadFont(v.font);
    if (id === readId && input.value === text && body.dataset.mode === 'set') show(v, text);
  } catch (e) {
    console.warn(e);
    if (id === readId && body.dataset.mode === 'set') status('read by rules · claude unreachable');
  }
}

function show(v, text) {
  loadFont(v.font); // applied at once; the browser swaps the glyphs in when the file lands
  swapId++; pending = null; input.classList.remove('swap');
  current = v.font;
  applyFace(v.font, v.setting);
  applyExpression(v.tone, v.setting.weight);
  applyField(v.tone);
  renderMeters(v.tone, hotOf(v.tone));
  grow();
  const ev = v.source === 'rules' ? v.evidence.slice(0, 6) : v.evidence;
  renderMirror(text, ev);
  renderNotes(v, ev);
  setMode('set');
  status(`read by ${v.source === 'ai' ? 'claude' : 'rules'} · ${v.intent}`);
}

async function fromClaude(text, a) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctrl.signal });
  clearTimeout(t);
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || res.status);
  const font = POOL.find((f) => f.name === out.font);
  if (!font) throw new Error('unknown font ' + out.font);
  const s = out.setting;
  return {
    source: 'ai', model: out.model, font, intent: lower(out.intent), voice: lower(out.voice), tone: out.tone,
    evidence: out.evidence, reasoning: [out.reasoning],
    alternates: out.alternates.map((x) => ({ name: x.font, why: x.why_not })),
    setting: { size: s.size_px, leading: s.leading, measure: s.measure_ch, weight: s.weight, why: s.why }, words: a.stats.words,
  };
}

function fromRules(a, note) {
  const r = recommend(a);
  const f = r.best.font, set = setting(a, f);
  const evidence = [];
  for (const d of DIMENSIONS) for (const w of new Set(a.hits[d.id])) evidence.push({ phrase: w, reading: lower(d.label) });
  const traits = r.best.parts.filter((x) => a.profile[x.id] >= 0.2).sort((x, y) => y.contrib - x.contrib).slice(0, 3)
    .map((x) => lower(DIMENSIONS.find((d) => d.id === x.id).label));
  const reasoning = [
    traits.length ? `The text leans toward ${traits.join(', ')}; ${f.name} has the closest profile.` : 'No strong tone stood out, so a calm, readable face won.',
    { short: 'It is short, so character counted for more than stamina.', medium: 'At this length, character and legibility were weighed evenly.', long: 'It is a long read, so legibility counted for more.' }[a.lengthClass],
  ];
  if (note) reasoning.unshift(note);
  const alternates = r.ranked.slice(1, 3).map((x) => {
    const gap = DIMENSIONS.map((d) => ({ d, g: Math.abs(a.profile[d.id] - x.font.t[d.id]) * (0.25 + a.profile[d.id]) })).sort((p, q) => q.g - p.g)[0].d;
    return { name: x.font.name, why: `further from the text on ${lower(gap.label)}.` };
  });
  return {
    source: 'rules', font: f, intent: INTENT_LABEL[a.intent], voice: null, tone: a.profile, evidence, reasoning, alternates,
    setting: { ...set, why: { short: 'short copy: large, tight leading.', medium: 'medium copy: comfortable reading size.', long: 'long copy: smaller, looser leading for stamina.' }[a.lengthClass] },
    words: a.stats.words,
  };
}

// The mirror sits exactly under the textarea, with the same metrics and
// transparent text, so marks line up with the words without duplicating them.
function renderMirror(text, phrases) {
  const list = [...new Set(phrases.map((p) => p.phrase).filter(Boolean))].sort((x, y) => y.length - x.length);
  const index = new Map();
  phrases.forEach((p) => { if (!index.has(lower(p.phrase))) index.set(lower(p.phrase), index.size + 1); });
  let html = '';
  if (list.length) {
    const re = new RegExp(`(?<![A-Za-z])(${list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z])`, 'gi');
    const seen = new Set();
    let last = 0;
    for (const m of text.matchAll(re)) {
      const n = index.get(lower(m[0]));
      const first = !seen.has(n); seen.add(n);
      html += esc(text.slice(last, m.index)) + `<mark${first ? ` data-n="${n}"` : ''}>${esc(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    html += esc(text.slice(last));
  } else html = esc(text);
  $('mirror').innerHTML = html + ' ';
}

function renderNotes(v, ev) {
  const s = v.setting;
  $('notes').innerHTML = `
    <section><h3>face</h3><p class="face">${esc(v.font.name)}</p><p class="r">${esc(lower(v.font.cls))} · ${esc(v.font.note)}</p></section>
    <section><h3>reads as</h3><p>${esc(v.intent)}${v.voice ? ` <span class="r">· ${esc(v.voice)}</span>` : ''}</p></section>
    ${ev.length ? `<section><h3>signals</h3><ol>${ev.map((e, i) => `<li><b>${i + 1}</b><span><q>${esc(e.phrase)}</q> <span class="r">→ ${esc(lower(e.reading))}</span></span></li>`).join('')}</ol></section>` : ''}
    <section><h3>why</h3>${v.reasoning.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
    ${v.alternates.length ? `<section><h3>also considered</h3><ul>${v.alternates.map((x) => `<li>${esc(x.name)} <span class="r">— ${esc(x.why)}</span></li>`).join('')}</ul></section>` : ''}
    <section><h3>suggested setting</h3><dl><dt>size</dt><dd>${s.size}px</dd><dt>leading</dt><dd>${s.leading}</dd><dt>measure</dt><dd>${s.measure}ch</dd><dt>weight</dt><dd>${s.weight}</dd></dl><p class="r" style="margin-top:6px">${esc(lower(s.why))}</p></section>
    <section><p class="r">${v.source === 'ai' ? `claude${v.model ? ` (${esc(v.model)})` : ''} chose from ${POOL.length} typefaces.` : `offline rules · ${FONTS.length} hand-scored faces.`}</p></section>`;
}

// ---------------------------------------------------------------- modes, keys, status
function status(t) { $('status').textContent = `> ${t}`; }
function setMode(m) {
  body.dataset.mode = m;
  const enter = '<kbd>enter</kbd>';
  $('keys').innerHTML = m === 'write' ? `${enter} set it · <kbd>shift</kbd>+${enter} new line`
    : m === 'reading' ? 'reading…' : `keep typing to edit · ${enter} read again`;
}

input.addEventListener('input', () => {
  if (body.dataset.mode === 'set') setMode('write'); // editing in place: marks fade, notes tuck away
  grow(); schedule();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); settle(); }
});
window.addEventListener('resize', grow);
// Re-measure whenever the type changes size under us: font files landing, size easing in.
input.addEventListener('transitionend', grow);
document.fonts.addEventListener?.('loadingdone', grow);

// Warm the offline faces so live swaps are instant.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
idle(() => FONTS.forEach((f, i) => setTimeout(() => loadFont(f), i * 60)));

// Start: restore a draft if there is one, otherwise an empty, listening screen.
{
  let draft = '';
  try { draft = localStorage.getItem('reactive-draft') || ''; } catch {}
  input.value = draft;
  setMode('write');
  applyField(null); renderMeters({});
  live();
  input.focus();
}
