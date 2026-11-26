// Reactive Type — Cloudflare Worker
// Holds the Anthropic API key and asks Claude to choose a typeface from pool.json.
// The browser never sees the key.

import pool from '../../pool.json';

const DIMENSIONS = ['warmth', 'joy', 'melancholy', 'intensity', 'tension', 'wonder', 'gravity', 'formality', 'technical'];
const NAMES = pool.map((f) => f.name);
const MAX_CHARS = 5000;

const SYSTEM = `You are a seasoned type director. Someone has written a piece of text and wants it set as body copy in the typeface that best fits it.

Read the text the way a designer would: its tone and emotional undercurrent, what kind of writing it is, who is speaking to whom, the voice or brand behind it, and how long it is. Understand context, irony, negation and subtext ("I'm fine." can be anything but fine).

Then choose ONE typeface for the body copy from the pool below, and set it.

Principles:
- This is body copy, not a logo. Long text needs a face with stamina; short text can carry more character.
- Match the voice, not the topic's clichés. A product launch wants confidence and clarity, not a casual brush face. Grief wants restraint, not a gothic font. Avoid novelty faces (handwriting, worn typewriter, wide display) unless the text genuinely calls for it.
- Prefer the choice an expert would defend in a critique.
- Explain plainly, as if to a smart non-designer: what you noticed in the text, and what in the letterforms answers it (contrast, terminals, width, x-height, rhythm, historical associations).

Pool (name — class: note):
${pool.map((f) => `${f.name} — ${f.cls}: ${f.note}`).join('\n')}`;

const TOOL = {
  name: 'set_type',
  description: 'Record the typeface choice, the reading of the text, and how to set it.',
  input_schema: {
    type: 'object',
    properties: {
      font: { type: 'string', enum: NAMES, description: 'The chosen typeface.' },
      intent: { type: 'string', description: 'What kind of writing this is, in 2-4 words, e.g. "product launch copy".' },
      voice: { type: 'string', description: 'The voice or emotional register in under 12 words.' },
      tone: {
        type: 'object',
        description: 'Strength of each quality in the text, 0 to 1.',
        properties: Object.fromEntries(DIMENSIONS.map((d) => [d, { type: 'number', minimum: 0, maximum: 1 }])),
        required: DIMENSIONS,
      },
      evidence: {
        type: 'array', maxItems: 6,
        description: 'Words or short phrases copied exactly from the text that shaped the reading.',
        items: {
          type: 'object',
          properties: { phrase: { type: 'string' }, reading: { type: 'string', description: 'What it signals, under 10 words.' } },
          required: ['phrase', 'reading'],
        },
      },
      reasoning: { type: 'string', description: '2-4 sentences: why this typeface suits this text.' },
      alternates: {
        type: 'array', maxItems: 2,
        description: 'Two close contenders and why they lost.',
        items: {
          type: 'object',
          properties: { font: { type: 'string', enum: NAMES }, why_not: { type: 'string', description: 'One sentence.' } },
          required: ['font', 'why_not'],
        },
      },
      setting: {
        type: 'object',
        properties: {
          size_px: { type: 'integer', minimum: 15, maximum: 36 },
          leading: { type: 'number', minimum: 1.15, maximum: 1.9 },
          measure_ch: { type: 'integer', minimum: 28, maximum: 75 },
          weight: { type: 'integer', enum: [300, 400, 500, 600, 700] },
          why: { type: 'string', description: 'One sentence on the size, leading and line length.' },
        },
        required: ['size_px', 'leading', 'measure_ch', 'weight', 'why'],
      },
    },
    required: ['font', 'intent', 'voice', 'tone', 'evidence', 'reasoning', 'alternates', 'setting'],
  },
};

function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    },
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export default {
  async fetch(req, env) {
    const c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, c.headers);
    if (!c.ok) return json({ error: 'Origin not allowed.' }, 403, c.headers);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Worker has no ANTHROPIC_API_KEY secret.' }, 500, c.headers);

    let text = '';
    try { text = String((await req.json()).text || '').trim(); } catch { /* fall through */ }
    if (text.split(/\s+/).length < 3) return json({ error: 'Send at least a sentence.' }, 400, c.headers);
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-5-5',
        max_tokens: 1200,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'set_type' },
        messages: [{ role: 'user', content: `Text to set:\n\n<text>\n${text}\n</text>` }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.log('Anthropic error', res.status, detail);
      return json({ error: 'The model could not be reached.', status: res.status }, 502, c.headers);
    }
    const data = await res.json();
    const out = (data.content || []).find((b) => b.type === 'tool_use')?.input;
    if (!out || !NAMES.includes(out.font)) return json({ error: 'The model returned no usable choice.' }, 502, c.headers);

    // Keep only evidence that really appears in the text, so the page can mark it.
    const lower = text.toLowerCase();
    out.evidence = (out.evidence || []).filter((e) => e.phrase && lower.includes(e.phrase.toLowerCase()));
    out.alternates = (out.alternates || []).filter((a) => NAMES.includes(a.font) && a.font !== out.font);
    out.model = data.model;
    return json(out, 200, c.headers);
  },
};
