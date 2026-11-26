# Reactive Type

Type that reads your tone and reacts as you write.

Start typing and the page listens. As the tone of your words shifts, the typeface changes to match: it gets heavier when you get angry, softens into a warm serif when you turn tender, and goes cold and typewritten when something gets tense. The whole field behind the text shifts colour with it. Press **Enter** and it does a deeper reading. It settles on one typeface, sets it properly, and annotates the exact words that drove the choice, like a proofreader's marks.

## Two speeds

- **Live (as you type).** Every keystroke updates the reading. Your newest words count most, and the word you're still typing is guessed from its first letters ("furi…" leans toward intensity before you finish), so the type moves ahead of you. Weight and letter spacing glide with the tone between typeface changes, and the meters show which way it's leaning. It all runs in the browser.
- **Considered (on Enter).** The offline reading appears instantly: the face settles, the signal words are marked, and the notes slide in. If Claude is connected, it refines the reading a moment later and swaps in its own choice and reasoning.

## Two readers

- **Claude (live).** When a Worker URL is set in `src/config.js`, the text goes to Claude, which reads it the way a type director would: tone, voice, intent, subtext and length. It then picks from a curated pool of **79 Google Fonts** (`pool.json`) and explains its choice in plain language. It also points to the exact phrases that shaped its reading, which the page underlines.
- **Rules (offline fallback).** If no Worker is configured or it can't be reached, a transparent scoring model picks from 36 hand-scored faces. It's described below.

## Hook up Claude (about 5 minutes)

GitHub Pages is public, so the API key lives in a tiny Cloudflare Worker (free tier) that sits between the page and Anthropic.

1. Get an API key at [console.anthropic.com](https://console.anthropic.com) and set a monthly spend limit there.
2. Deploy the Worker:
   ```bash
   cd worker
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY   # paste your key
   npx wrangler deploy
   ```
3. Copy the URL it prints (`https://reactive-type.<you>.workers.dev`) into `src/config.js`.
4. In `worker/wrangler.toml`, set `ALLOWED_ORIGINS` to your Pages URL (for example `https://yourname.github.io`) and deploy again, so other sites can't use your key.

`MODEL` in `wrangler.toml` picks the model: `claude-sonnet-5-5` reads with more nuance, while `claude-haiku-5-5` is faster and cheaper. The Worker forces a structured answer, restricts the choice to fonts in `pool.json`, and drops any quoted evidence that isn't actually in the text.

## How the face is chosen

Live and Enter make **one** decision, so the face you watch while typing is the face that gets set.

1. **Read the tone** (below): nine tones plus an overall mood from dark to bright. Your newest words, and the sentence you're on, count most.
2. **Pick the level.** The strongest tone's score picks a tier: **light** (under 42), **mid** (42–72) or **strong** (72+). Word strength matters: *annoyed* is mid, *furious, stop lying!* is strong.
3. **Pick within the tier.** Each level holds two to four faces from the 79-face pool (`src/curate.js`). The undertone, the mood and the text's opening words choose among them, so different texts in the same mood get different faces, while one text holds steady as you type.
4. **Guardrails.** Faces that are wrong for the kind of writing are skipped (no handwriting for a formal letter, no novelty face for instructions). Long texts step down a level so the face can carry paragraphs. A small hold stops flicker near a boundary, and it lets go the moment the mood flips.

Edit the tiers in `src/curate.js` to change its taste.

## How the offline rules work

1. **Read.** It counts words, sentences, average sentence and word length, exclamations, questions, ellipses, contractions, numbers, imperative sentences and line breaks.
2. **Feel.** A hand-written lexicon maps words to nine tone dimensions: warmth, joy, melancholy, intensity, tension, wonder, gravity, formality and technical. Behind it, the [VADER](https://github.com/cjhutto/vaderSentiment) sentiment lexicon (about 5,500 words) gives every other word a positive or negative weight, so "horrible" or "devastated" register even though they aren't in the hand list. Contempt reads as intensity, hurt as melancholy. Punctuation nudges the result (ellipses add melancholy and tension, capitals and exclamations add intensity).
   - **Direction.** An overall mood from dark to bright is computed. A clearly negative message can't read as warm or joyful ("Hello Mother, wishing you a horrible day" is hostile, not loving), and bright, bouncy faces are kept away from hostile or grieving text.
   - **Negation and turns.** "Not happy" reads as low, not neutral. Words like *but*, *nevermind* and *just kidding* discount what came before, and the ending of a message counts most.
   - **Phrases.** A few phrases override their words: "thanks for nothing", "yeah right", "I can't do this anymore".
3. **Classify.** The text is read as one of: narrative, poetic, personal message, formal writing, instructions, promotional copy or general prose.
4. **Match.** Each of the 36 typefaces in the pool has trait scores on the same nine dimensions, plus *legibility* (stamina over long text) and *personality* (character in short bursts). The score compares the text's profile with each face, weighting the dimensions the text expresses most strongly. Faces suited to the intent get a small bonus, and faces that are wrong for it (a casual brush face for launch copy, for example) get a penalty. Long text rewards legibility; short text rewards personality.
5. **Set.** Size, leading, line length and weight follow from length and the face's own proportions.

While you write, the meters on the left show the live tone. Press **Enter** for the considered reading (**Shift+Enter** adds a new line), and **Esc**, or just keep typing, to go back to writing.

## Run it

It's a static site with no build step and no dependencies.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To deploy, push to GitHub and turn on **Settings → Pages → Deploy from branch (main, root)**.

## Project structure

```
index.html        page
styles.css        styles
pool.json         the 80-font pool Claude chooses from
worker/           Cloudflare Worker that holds the API key and asks Claude
src/config.js     your Worker URL
src/curate.js     the curated light / mid / strong tiers for each tone
src/lexicon.js    tone dimensions and word lists
src/valence.js    VADER word valence (MIT), positive and negative weights
src/analyze.js    text → tone profile, intent, length, evidence
src/fonts.js      typeface pool with trait scores
src/recommend.js  scoring, ranking and typesetting rules
src/app.js        live reaction, colour field, reading view
fonts/            Departure Mono (interface type, SIL OFL), self-hosted
```

## Tuning

- **Grow Claude's pool:** add a line to `pool.json` (name, class, one-line note). The page and the Worker both read it.
- **Add a typeface to the offline rules:** add an entry to `src/fonts.js` with a Google Fonts query string, trait scores and the intents it suits.
- **Teach it words:** add to the lists in `src/lexicon.js`.
- **Change its taste:** the weights in `src/recommend.js` decide how much tone, intent and length each count.

## Roadmap

- Learn typeface traits from designers' choices instead of assigning them by hand.
- Per-sentence typesetting: let variable-font axes follow the emotion as it changes through the text.
- Headline + body pairing for longer documents.

## Credits

The writing typefaces are from Google Fonts. Word valence comes from the VADER lexicon by C.J. Hutto (MIT License). The interface is set in [Departure Mono](https://departuremono.com) by Helena Zhang. All the fonts are under the SIL Open Font License (see `fonts/DepartureMono-OFL.txt`). The code is MIT-licensed.
