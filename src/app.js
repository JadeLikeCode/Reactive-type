// Reactive Type
// Two speeds: a fast local reading reacts on every keystroke;
// Enter asks Claude (or the offline rules) for a considered reading.

import { analyze } from './analyze.js';
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
  neutral:    { base: '#101114', g: ['#2b3140', '#1c2a2a', '#24202e'], accent: '#9ad0ff' },
  warmth:     { base: '#2a120c', g: ['#ff6a3d', '#ffb070', '#c2410c'], accent: '#ffd2a8' },
  joy:        { base: '#f3ecdc', g: ['#ffcf3f', '#ff7ac6', '#7ee0ff'], accent: '#d6336c' },
  melancholy: { base: '#0c1320', g: ['#3b5a8a', '#6f7f99', '#1e2f4d'], accent: '#a9c1e8' },
  intensity:  { base: '#1c0505', g: ['#ff2a1a', '#ff8a00', '#8a0d0d'], accent: '#ffd166' },
  tension:    { base: '#040605', g: ['#1f7a4a', '#0d2a1d', '#3a1d1d'], accent: '#62ff9d' },
  wonder:     { base: '#0b0a24', g: ['#7b5cff', '#38d1ff', '#ff8be0'], accent: '#c7b8ff' },
  gravity:    { base: '#17150f', g: ['#8a7a55', '#3a3428', '#5b4a2e'], accent: '#e3d3a8' },
  formality:  { base: '#ebeae5', g: ['#c9ccd6', '#9aa3b5', '#e2dccd'], accent: '#3446a3' },
  technical:  { base: '#071016', g: ['#00b8e6', '#2a5cff', '#0b3a4a'], accent: '#00e1ff' },
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
  const raw = keys.map((k) => (k === 'neutral' ? 0.12 : clamp01(tone?.[k]) ** 2.2));
  const sum = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((x) => x / sum);
  const base = mix(keys.map((k) => FIELDS[k].base), w);
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  root.setProperty('--base', toHex(base));
  root.setProperty('--ink', lum > 0.35 ? '#141416' : '#f1efe9');
  [0, 1, 2].forEach((i) => root.setProperty(`--g${i + 1}`, toHex(mix(keys.map((k) => FIELDS[k].g[i]), w))));
  // Accent follows the strongest tone, so it stays a real colour rather than a muddy average.
  const top = keys[w.indexOf(Math.max(...w))];
  root.setProperty('--accent', FIELDS[top].accent);
  body.toggleAttribute('data-pulse', Math.max(...raw.slice(1)) > 0.5);
}

// ---------------------------------------------------------------- fonts
let POOL = [];
const poolReady = fetch('pool.json').then((r) => r.json()).then((p) => { POOL = p; }).catch(() => {});
const loaded = new Map();
function loadFont(f) {
  if (loaded.has(f.name)) return loaded.get(f.name);
  const n = f.name.replace(/ /g, '+');
  const tries = [f.q, `${n}:ital,wght@0,400;0,700;1,400`, `${n}:wght@400;700`, n].filter(Boolean);
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
  root.setProperty('--weight', set?.weight || 400);
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
function renderMeters(tone, hot = []) {
  $('meters').innerHTML = DIMENSIONS.map((d) => {
    const v = clamp01(tone?.[d.id]);
    const n = Math.round(v * 10);
    return `<div class="meter${hot.includes(d.id) ? ' hot' : ''}" title="${esc(d.hint)}"><span>${esc(lower(d.label))}</span><span class="bar">${'▮'.repeat(n)}${'▯'.repeat(10 - n)}</span><span class="v">${String(Math.round(v * 100)).padStart(2, '0')}</span></div>`;
  }).join('');
}
const hotOf = (tone) => Object.entries(tone).filter(([, v]) => v >= 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);

// ---------------------------------------------------------------- live reaction
let current = null, currentScore = 0, liveTimer = 0;
function grow() { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; }

function live() {
  const text = input.value;
  const words = (text.match(/[A-Za-z']+/g) || []).length;
  applyScale(words);
  grow();
  try { localStorage.setItem('reactive-draft', text); } catch {}
  if (words < 3) {
    applyField(null); renderMeters({}); swapFace(null);
    status(words ? 'keep going…' : 'listening'); return;
  }
  // React to the most recent passage so the type follows the tone as it turns.
  const recent = (text.match(/[^\s]+/g) || []).slice(-60).join(' ');
  const a = analyze(recent);
  const full = analyze(text);
  const r = recommend({ ...a, lengthFactor: full.lengthFactor, lengthClass: full.lengthClass });
  applyField(a.profile);
  renderMeters(a.profile, hotOf(a.profile));
  const quiet = Math.max(...Object.values(a.profile)) < 0.15;
  const best = quiet && words < 8 ? null : r.best;
  // Hysteresis: only change face when the new one clearly wins, so it doesn't flicker.
  if (best && current && best.font.name !== current.name) {
    const cur = r.ranked.find((x) => x.font.name === current.name);
    if (cur && best.score - cur.score < 0.025) { status(`${words} words · reads as ${INTENT_LABEL[full.intent]}`); return; }
  }
  swapFace(best ? best.font : null, best ? setting(full, best.font) : null);
  status(`${words} words · reads as ${INTENT_LABEL[full.intent]}`);
}

let swapId = 0;
async function swapFace(f, set) {
  if ((f?.name || null) === (current?.name || null)) { if (set) root.setProperty('--weight', set.weight); return; }
  const id = ++swapId;
  if (f) await loadFont(f);
  if (id !== swapId) return;
  input.classList.add('swap');
  setTimeout(() => {
    if (id !== swapId) return;
    current = f;
    applyFace(f, set);
    grow();
    input.classList.remove('swap');
  }, 160);
}

// ---------------------------------------------------------------- the considered reading
async function settle() {
  const text = input.value;
  if ((text.match(/[A-Za-z']+/g) || []).length < 3) { status('write a sentence first'); return; }
  const a = analyze(text);
  setMode('reading');
  input.readOnly = true;
  status(WORKER_URL ? 'claude is reading…' : 'reading…');
  let v = null, note = '';
  if (WORKER_URL) {
    try { await poolReady; v = await fromClaude(text, a); }
    catch (e) { console.warn(e); note = 'Claude was unreachable, so the offline rules made this reading.'; }
  }
  if (!v) v = fromRules(a, note);
  await loadFont(v.font);
  input.readOnly = false;
  if (input.value !== text) return; // they kept typing; stay live
  swapId++; // cancel any pending live swap
  input.classList.remove('swap');
  current = v.font;
  applyFace(v.font, v.setting);
  grow();
  applyField(v.tone);
  renderMeters(v.tone, hotOf(v.tone));
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
    <section><p class="r">${v.source === 'ai' ? `claude${v.model ? ` (${esc(v.model)})` : ''} chose from ${POOL.length} typefaces.` : 'offline rules · 20 hand-scored faces.'}</p></section>`;
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
  clearTimeout(liveTimer); liveTimer = setTimeout(live, 140); grow();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (body.dataset.mode !== 'reading') settle(); }
});
window.addEventListener('resize', grow);

// Warm the offline faces so live swaps are instant.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
idle(() => FONTS.forEach((f, i) => setTimeout(() => loadFont(f), i * 120)));

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
