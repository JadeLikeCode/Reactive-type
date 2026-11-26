// Hand-written tone lexicon. Each word maps to one tone dimension.
// Tokens are matched raw and after light stemming (see analyze.js),
// so list base forms: "grieve" also catches "grieving", "grieved".

export const DIMENSIONS = [
  { id: 'warmth',      label: 'Warmth',      hint: 'affection, comfort, closeness' },
  { id: 'joy',         label: 'Joy',         hint: 'delight, celebration, play' },
  { id: 'melancholy',  label: 'Melancholy',  hint: 'loss, longing, quiet sadness' },
  { id: 'intensity',   label: 'Intensity',   hint: 'anger, urgency, force' },
  { id: 'tension',     label: 'Tension',     hint: 'fear, suspense, unease' },
  { id: 'wonder',      label: 'Wonder',      hint: 'imagery, awe, the lyrical' },
  { id: 'gravity',     label: 'Gravity',     hint: 'weight, seriousness, history' },
  { id: 'formality',   label: 'Formality',   hint: 'register, distance, protocol' },
  { id: 'technical',   label: 'Technical',   hint: 'precision, data, instruction' },
];

const words = {
  warmth: `love loved lovely darling sweet sweetheart hug embrace cozy cosy warm gentle tender kind
    kindness care caring comfort home family mother mom mum father dad grandma grandmother grandpa friend
    friendship together hold heart soft safe thank thanks grateful gratitude welcome miss cherish kiss
    blanket tea kitchen honey baby belong`,
  joy: `happy happiness joy joyful delight delighted fun funny laugh laughter smile grin glad yay hooray
    celebrate celebration party excited exciting amazing awesome wonderful fantastic great brilliant
    cheer cheerful dance sunny playful silly giggle wow win winner bright beautiful best surprise lol haha`,
  melancholy: `sad sadness sorrow grief grieve mourn loss lost lonely alone empty miss missing tears tear
    cry cried weep ache longing gone goodbye farewell regret remember memory memories faded fade quiet
    gray grey rain autumn winter ash hollow broken heartbreak heartbroken anymore tired exhausted
    leaving numb hurt hurts pain devastated disappointed disappointing heavy`,
  intensity: `angry anger rage furious fury hate hated scream shout yell fight fighting war attack
    destroy burn burning fire explode explosion urgent immediately demand enough stop furious promised betray betrayed liar
    power powerful force fast faster crash smash break bold fierce wild loud`,
  tension: `fear afraid scared terror terrified dread anxious anxiety nervous panic dark darkness shadow
    shadows creep creeping whisper silence silent footsteps door locked blood scream knife suddenly
    behind waiting watched watching strange wrong cold trembling hide hidden danger threat`,
  wonder: `sky sea ocean moon stars star light glow shimmer dream dreams dreaming wonder wander forest
    river mountain dawn dusk twilight morning evening golden silver mist bloom petal flower wind wings
    endless infinite magic ancient horizon breath song sing`,
  gravity: `death die died dying life history historic duty honor honour responsibility justice law
    nation war sacrifice memorial legacy solemn truth serious crisis grave witness generation
    century government rights freedom`,
  formality: `regarding pursuant hereby accordingly therefore furthermore moreover sincerely respectfully
    dear sir madam committee board policy please kindly request enclosed attached shall whereas
    stakeholders organization organisation proposal agenda quarterly fiscal compliance`,
  technical: `data system systems install installation configure configuration function parameter
    parameters server api code version update database algorithm model input output file files
    click select settings step steps measure measurement mg ml kg cm mm temperature voltage
    specification spec percent ratio sample method procedure analysis`,
};

export const LEXICON = new Map();
for (const [dim, list] of Object.entries(words)) {
  for (const w of list.split(/\s+/).filter(Boolean)) {
    if (!LEXICON.has(w)) LEXICON.set(w, dim);
  }
}

export const NEGATORS = new Set(['not', 'no', 'never', "isn't", "wasn't", "don't", "didn't", "can't",
  "won't", 'without', 'hardly', "aren't", "weren't", 'nor']);

// Small signal word groups used for intent detection.
export const INFORMAL = new Set(['lol', 'haha', 'omg', 'gonna', 'wanna', 'yeah', 'yep', 'nope', 'hey',
  'ok', 'okay', 'cool', 'stuff', 'kinda', 'sorta', 'literally', 'super', 'tbh', 'btw']);
export const MARKETING = new Set(['new', 'introducing', 'free', 'now', 'today', 'discover', 'get',
  'save', 'exclusive', 'limited', 'best', 'ultimate', 'launch', 'join', 'shop', 'order', 'try']);
export const IMPERATIVE_STARTS = new Set(['click', 'select', 'open', 'add', 'remove', 'install', 'run',
  'press', 'enter', 'type', 'turn', 'set', 'go', 'use', 'make', 'check', 'mix', 'stir', 'heat',
  'place', 'insert', 'connect', 'save', 'choose', 'pour', 'measure', 'wait', 'repeat']);
