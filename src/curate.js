// Curated typeface tiers.
// Each tone has three levels — light, mid, strong — and each level holds a few
// faces from pool.json. The strength of the tone picks the level; the undertone
// and the text's opening words pick within it, so two texts with the same mood
// rarely get the same face, but one text never flickers between them.

export const TIERS = {
  warmth: {
    light: ['Lora', 'Literata', 'Gelasio'],
    mid: ['Fraunces', 'Petrona', 'Alegreya', 'Vollkorn'],
    strong: ['Young Serif', 'Caveat', 'Patrick Hand'],
  },
  joy: {
    light: ['Work Sans', 'Figtree', 'DM Sans', 'Karla'],
    mid: ['Nunito', 'Rubik', 'Outfit', 'Plus Jakarta Sans'],
    strong: ['Unbounded', 'Bricolage Grotesque', 'Young Serif'],
  },
  melancholy: {
    light: ['Spectral', 'Crimson Pro', 'Newsreader'],
    mid: ['EB Garamond', 'Cormorant Garamond', 'Castoro'],
    strong: ['IM Fell English', 'Cardo', 'Sorts Mill Goudy'],
  },
  intensity: {
    light: ['Schibsted Grotesk', 'Libre Franklin', 'Public Sans'],
    mid: ['Archivo', 'Familjen Grotesk', 'Bricolage Grotesque'],
    strong: ['Big Shoulders Text', 'Archivo'],
  },
  tension: {
    light: ['Newsreader', 'Piazzolla', 'Faustina'],
    mid: ['Courier Prime', 'Cutive Mono', 'Space Mono'],
    strong: ['Special Elite', 'Courier Prime'],
  },
  wonder: {
    light: ['Josefin Sans', 'Raleway', 'Spectral'],
    mid: ['Cormorant Garamond', 'Playfair Display', 'Alegreya'],
    strong: ['Syne', 'IM Fell English', 'Cormorant Garamond'],
  },
  gravity: {
    light: ['Source Serif 4', 'PT Serif', 'Merriweather'],
    mid: ['Libre Baskerville', 'Brygada 1918', 'Besley'],
    strong: ['Old Standard TT', 'Libre Caslon Text', 'Cardo'],
  },
  formality: {
    light: ['Source Serif 4', 'IBM Plex Serif', 'Public Sans'],
    mid: ['Libre Baskerville', 'Libre Caslon Text', 'DM Serif Text'],
    strong: ['Bodoni Moda', 'Old Standard TT', 'Playfair Display'],
  },
  technical: {
    light: ['IBM Plex Sans', 'Atkinson Hyperlegible', 'Fira Sans', 'Lexend'],
    mid: ['Space Grotesk', 'Manrope', 'Sora', 'Barlow'],
    strong: ['JetBrains Mono', 'IBM Plex Mono', 'Space Mono', 'DM Mono'],
  },
  neutral: {
    light: ['Literata', 'Source Serif 4', 'Hanken Grotesk', 'Onest', 'Atkinson Hyperlegible', 'Mulish'],
  },
};

// Faces to keep off certain kinds of writing, whatever the tone says.
const AVOID = {
  formal: ['Caveat', 'Patrick Hand', 'Unbounded', 'Special Elite', 'Bricolage Grotesque', 'Young Serif'],
  instructional: ['Caveat', 'Patrick Hand', 'IM Fell English', 'Cormorant Garamond', 'Bodoni Moda', 'Special Elite'],
  marketing: ['Caveat', 'Patrick Hand', 'Special Elite', 'IM Fell English', 'Cardo'],
};
// Faces that need some length to be legible; long text steps down a level instead.
const DISPLAY = new Set(['Caveat', 'Patrick Hand', 'Unbounded', 'Big Shoulders Text', 'Special Elite', 'IM Fell English',
  'Bodoni Moda', 'Syne', 'Cormorant Garamond', 'Playfair Display', 'Sorts Mill Goudy']);

export const LEVELS = ['light', 'mid', 'strong'];
const CUTS = [0.42, 0.72]; // below 0.42 light, below 0.72 mid, else strong

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// prev: the last pick, used for hysteresis so the face holds near a boundary.
export function curate(profile, { valence = 0, intent = 'general', words = 0, seed = '', prev = null } = {}) {
  const ranked = Object.entries(profile).sort((a, b) => b[1] - a[1]);
  let [dim, val] = ranked[0];
  const second = ranked[1]?.[1] >= 0.2 ? ranked[1][0] : null;

  // Hold the current tone unless another clearly overtakes it, or the mood itself flips.
  const flipped = prev && ((prev.valence > 0.15 && valence < -0.15) || (prev.valence < -0.15 && valence > 0.15));
  if (prev && !flipped && prev.dim !== dim && profile[prev.dim] != null && val - profile[prev.dim] < 0.08 && profile[prev.dim] >= 0.2) {
    dim = prev.dim; val = profile[dim];
  }
  if (val < 0.2) dim = 'neutral';

  let li = dim === 'neutral' ? 0 : val < CUTS[0] ? 0 : val < CUTS[1] ? 1 : 2;
  // Hysteresis on the level: a small wobble around a cut doesn't change the face.
  if (prev && prev.dim === dim && prev.level !== LEVELS[li]) {
    const pi = LEVELS.indexOf(prev.level);
    const cut = CUTS[Math.min(pi, li)];
    if (Math.abs(val - cut) < 0.05) li = pi;
  }
  // Long reads step down a level so the face can carry paragraphs.
  if (words > 160 && li > 0) li -= 1;

  // If every face at this level is wrong for the kind of writing, step down a level rather than give up.
  const usable = (lvl) => (TIERS[dim][lvl] || []).filter((n) => !(AVOID[intent] || []).includes(n) && !(words > 160 && DISPLAY.has(n)));
  let list = usable(LEVELS[li]);
  while (!list.length && li > 0) { li -= 1; list = usable(LEVELS[li]); }
  if (!list.length) list = TIERS.neutral.light;
  const level = LEVELS[li];

  // Pick within the tier: stable for this text (seeded by its opening words),
  // nudged by the undertone and the mood's direction, different across texts.
  const nudge = (second ? Object.keys(profile).indexOf(second) + 1 : 0) + (valence < -0.2 ? 2 : valence > 0.2 ? 1 : 0);
  const idx = (hash(seed) + nudge) % list.length;
  const name = list[idx];
  const others = list.filter((n) => n !== name);
  return { name, dim, level, value: val, second, others, tier: list, valence };
}
