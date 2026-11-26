import { analyze, lookup } from './analyze.js';
import { recommend, setting } from './recommend.js';
import { DIMENSIONS } from './lexicon.js';
import { WORKER_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100);

const SAMPLES = {
  'A short story': `The morning after the storm, my grandmother walked down to the shore. She had lived in the house for sixty years and knew every sound it made. The sea was quiet and strangely bright, and she stood there a long time, remembering the boats that never came back.\n\n"They always said the water forgives," she told me later, "but it doesn't forget."`,
  'A hard text': `I don't know how to say this... I keep thinking about the last time we were together and how empty it felt. I miss you, but I think we're already gone.`,
  'A product launch': `Introducing Flow, the new way to plan your week! Get started free today and discover how good it feels to finally be on top of everything. Join 10,000 teams now.`,
  'Lab steps': `1. Measure 50 ml of the sample into a clean beaker.\n2. Heat to 60 °C and stir for 5 minutes.\n3. Record the temperature every 30 seconds.\n4. Repeat the procedure with the second sample and compare the data.`,
  'A suspense scene': `The footsteps stopped outside the door. Silence. Then a whisper, so close it was almost inside her. She held her breath in the dark and waited... something was wrong.`,
  'A birthday note': `Happy birthday, sweetheart!! Hope your day is full of cake, silly dancing and everyone who loves you. Can't wait to celebrate this weekend, haha!`,
  'A formal letter': `Dear members of the committee,\n\nI am writing regarding the proposal submitted last quarter. Furthermore, we respectfully request that the board review the attached policy prior to the fiscal year deadline.\n\nSincerely,\nThe operations team`,
};

const INTENT_LABEL = {
  story: 'Narrative', poem: 'Poetic / lyrical', personal: 'Personal message', formal: 'Formal writing',
  instructional: 'Instructions', marketing: 'Promotional copy', general: 'General prose',
};

// ---------- Fonts: try the rich request, fall back to the plain family, so nothing can break.
let POOL = [];
const poolReady = fetch('pool.json').then((r) => r.json()).then((p) => { POOL = p; }).catch(() => {});
const loaded = new Map();
function loadFont(f) {
  if (loaded.has(f.name)) return loaded.get(f.name);
  const n = f.name.replace(/ /g, '+');
  const tries = [f.q, `${n}:ital,wght@0,400;0,700;1,400`, `${n}:wght@400;700`, n].filter(Boolean);
  const attempt = (i) => new Promise((resolve) => {
    if (i >= tries.length) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${tries[i]}&display=swap`;
    link.onload = () => document.fonts.load(`400 20px "${f.name}"`).then(resolve, resolve);
    link.onerror = () => { link.remove(); attempt(i + 1).then(resolve); };
    document.head.appendChild(link);
    setTimeout(resolve, 3000);
  });
  const p = attempt(0);
  loaded.set(f.name, p);
  return p;
}
const stack = (f) => `"${f.name}", ${/mono|typewriter/i.test(f.cls) ? 'ui-monospace, monospace' : /sans|grotesque|grotesk|gothic|geometric/i.test(f.cls) ? 'system-ui, sans-serif' : /hand/i.test(f.cls) ? 'cursive' : 'Georgia, serif'}`;

// ---------- Composer
const input = $('input');
$('samples').innerHTML = Object.keys(SAMPLES).map((k) => `<button type="button" data-k="${esc(k)}">${esc(k)}</button>`).join('');
$('samples').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  input.value = SAMPLES[b.dataset.k];
  run();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(); }
});
input.addEventListener('input', () => { $('error').textContent = ''; try { localStorage.setItem('emotive-draft', input.value); } catch {} });
$('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
$('marks').addEventListener('change', () => $('specimen').classList.toggle('show-marks', $('marks').checked));

let busy = false;
async function run() {
  if (busy) return;
  const text = input.value.trim();
  if ((text.match(/[A-Za-z']+/g) || []).length < 3) {
    $('error').textContent = 'Write at least a sentence so there is something to read.'; input.focus(); return;
  }
  busy = true; $('go').textContent = 'Reading…'; $('specimen').classList.add('loading');
  const a = analyze(text);
  let view = null, note = '';
  if (WORKER_URL) {
    try {
      await poolReady;
      view = await fromClaude(text, a);
    } catch (err) {
      note = 'Claude could not be reached, so this reading uses the offline rules.';
      console.warn(err);
    }
  }
  if (!view) view = fromRules(a, note);
  await render(view);
  busy = false; $('go').textContent = 'Set it';
}

// ---------- Two readers, one view
async function fromClaude(text, a) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const res = await fetch(WORKER_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }), signal: ctrl.signal,
  });
  clearTimeout(timer);
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || res.status);
  const font = POOL.find((f) => f.name === out.font);
  if (!font) throw new Error('Unknown font ' + out.font);
  const s = out.setting;
  return {
    source: 'ai', model: out.model, a, text, font,
    intent: out.intent, voice: out.voice, tone: out.tone,
    evidence: out.evidence,
    reasoning: [out.reasoning],
    alternates: out.alternates.map((x) => ({ name: x.font, why: x.why_not })),
    setting: { size: s.size_px, leading: s.leading, measure: s.measure_ch, weight: s.weight, why: s.why },
  };
}

function fromRules(a, note) {
  const r = recommend(a);
  const best = r.best, f = best.font, set = setting(a, f);
  const evidence = [];
  for (const d of DIMENSIONS) for (const w of new Set(a.hits[d.id])) evidence.push({ phrase: w, reading: d.label });
  const reasons = best.parts.filter((x) => a.profile[x.id] >= 0.2).sort((x, y) => y.contrib - x.contrib).slice(0, 3)
    .map((x) => DIMENSIONS.find((d) => d.id === x.id).label.toLowerCase());
  const reasoning = [
    reasons.length
      ? `The text leans toward ${reasons.join(', ')}, and ${f.name}'s traits sit closest to that profile.`
      : `No strong emotion stood out, so it favored a calm, readable face.`,
    a.lengthClass === 'long' ? 'It is a long read, so legibility counted for more.'
      : a.lengthClass === 'short' ? 'It is short, so character counted for more than stamina.'
      : 'At this length, legibility and character were weighed about evenly.',
  ];
  if (note) reasoning.unshift(note);
  const alternates = r.ranked.slice(1, 3).map((x) => {
    const gap = DIMENSIONS.map((d) => ({ d, g: Math.abs(a.profile[d.id] - x.font.t[d.id]) * (0.25 + a.profile[d.id]) }))
      .sort((p, q) => q.g - p.g)[0].d.label.toLowerCase();
    return { name: x.font.name, why: `${x.match}% match; further from the text on ${gap}.` };
  });
  return {
    source: 'rules', a, text: a.text, font: f, intent: INTENT_LABEL[a.intent], voice: null, tone: a.profile,
    evidence, reasoning, alternates, ranking: r.ranked,
    setting: { ...set, why: { short: 'Short copy is set larger, with tighter leading.', medium: 'Medium copy at a comfortable reading size.', long: 'Long copy is set smaller, with looser leading for stamina.' }[a.lengthClass] },
  };
}

// ---------- Rendering
function markText(text, phrases) {
  const list = [...new Set(phrases.map((p) => p.phrase).filter(Boolean))].sort((x, y) => y.length - x.length);
  const reading = new Map(phrases.map((p) => [p.phrase.toLowerCase(), p.reading]));
  const re = list.length ? new RegExp(`(?<![A-Za-z])(${list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z])`, 'gi') : null;
  const line = (l) => {
    if (!re) return esc(l);
    let out = '', last = 0;
    for (const m of l.matchAll(re)) {
      out += esc(l.slice(last, m.index)) + `<mark title="${esc(reading.get(m[0].toLowerCase()) || '')}">${esc(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    return out + esc(l.slice(last));
  };
  return text.split(/\n{2,}/).map((p) => '<p>' + p.split('\n').map(line).join('<br>') + '</p>').join('');
}

async function render(v) {
  const f = v.font, s = v.setting;
  await loadFont(f);
  const sp = $('specimen');
  sp.innerHTML = markText(v.text, v.evidence);
  Object.assign(sp.style, {
    fontFamily: stack(f), fontSize: s.size + 'px', lineHeight: s.leading, fontWeight: s.weight,
    fontVariationSettings: f.fvs || 'normal',
  });
  sp.style.setProperty('--measure', s.measure + 'ch');
  sp.classList.remove('loading');

  $('pick-name').textContent = f.name;
  $('pick-name').style.fontFamily = stack(f);
  $('pick-name').style.fontVariationSettings = f.fvs || 'normal';
  $('pick-class').textContent = f.cls;
  $('pick-source').textContent = v.source === 'ai' ? 'Read by Claude' : 'Read by rules';
  $('pick-note').textContent = f.note;

  // 1. Read
  const st = v.a.stats;
  const rows = [['Reads as', v.intent], ...(v.voice ? [['Voice', v.voice]] : []),
    ['Words', st.words], ['Sentences', st.sentences], ['Avg. sentence', `${st.avgSentence} words`], ['Length', v.a.lengthClass]];
  $('read').innerHTML = rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('');

  // 2. Feel
  const top = Object.entries(v.tone).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => k);
  $('feel-sub').textContent = v.source === 'ai' ? 'The emotional register, as Claude read it' : 'From word choice and punctuation';
  const ev = v.source === 'ai' && v.evidence.length
    ? `<ul class="evidence">${v.evidence.map((e) => `<li><q>${esc(e.phrase)}</q> ${esc(e.reading)}</li>`).join('')}</ul>` : '';
  $('feel').innerHTML = DIMENSIONS.map((d) => {
    const val = v.tone[d.id];
    const words = v.source === 'rules' ? [...new Set(v.a.hits[d.id])].slice(0, 6) : [];
    return `<div class="bar${top.includes(d.id) && val >= 0.2 ? ' hot' : ''}" title="${esc(d.hint)}">
      <span>${esc(d.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct(val)}%"></span></span>
      <span class="bar-val">${pct(val)}</span>${words.length ? `<span class="words">${words.map(esc).join(', ')}</span>` : ''}</div>`;
  }).join('') + ev;

  // 3. Match
  $('match').innerHTML = v.reasoning.map((p) => `<p>${esc(p)}</p>`).join('') +
    (v.alternates.length ? `<p class="also">Also considered</p><ul class="alts-list">${v.alternates.map((x) => `<li><b>${esc(x.name)}</b> ${esc(x.why)}</li>`).join('')}</ul>` : '');

  // 4. Set
  $('set').innerHTML = [['Size', `${s.size}px`], ['Leading', s.leading], ['Line length', `${s.measure} characters`], ['Weight', s.weight]]
    .map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('') + `<dt class="set-why">${esc(s.why)}</dt>`;

  $('all').hidden = v.source !== 'rules';
  if (v.ranking) $('ranking').innerHTML = v.ranking.map((x) => `<li>${esc(x.font.name)} <span>${x.match}%</span></li>`).join('');
  $('method').textContent = v.source === 'ai'
    ? `Claude${v.model ? ` (${v.model})` : ''} read the text and chose from a curated pool of ${POOL.length} Google Fonts. The marked words are the ones it pointed to.`
    : 'Offline mode: a hand-written tone lexicon plus punctuation and structure signals, compared with typeface traits a designer assigned to 21 faces.';

  $('result').hidden = false; $('how').hidden = false;
}

// ---------- Start mid-use: restore a draft or show the sample
{
  let draft = '';
  try { draft = localStorage.getItem('emotive-draft') || ''; } catch {}
  input.value = draft.trim() ? draft : SAMPLES['A short story'];
  run();
}
