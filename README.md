# Emotive Type

Write or paste some copy. Emotive Type reads its **tone**, **intent** and **length**, picks a body typeface to match, sets it, and explains why.

Choosing a typeface is one of the hardest calls in design and one of the least explained. This project makes that judgement legible: every pick traces back to specific words, punctuation and structure in your text.

## Two readers

- **Claude (live).** When a Worker URL is set in `src/config.js`, the text goes to Claude, which reads it the way a type director would: tone, voice, intent, subtext and length. It then picks from a curated pool of **80 Google Fonts** (`pool.json`) and explains its choice in plain language. It also points to the exact phrases that shaped its reading, which the page underlines.
- **Rules (offline fallback).** If no Worker is configured or it can't be reached, a transparent scoring model picks from 21 hand-scored faces. It's described below.

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
3. Copy the URL it prints (`https://emotive-type.<you>.workers.dev`) into `src/config.js`.
4. In `worker/wrangler.toml`, set `ALLOWED_ORIGINS` to your Pages URL (for example `https://yourname.github.io`) and deploy again, so other sites can't use your key.

`MODEL` in `wrangler.toml` picks the model: `claude-sonnet-5-5` reads with more nuance, while `claude-haiku-5-5` is faster and cheaper. The Worker forces a structured answer, restricts the choice to fonts in `pool.json`, and drops any quoted evidence that isn't actually in the text.

## How the offline rules work

1. **Read.** It counts words, sentences, average sentence and word length, exclamations, questions, ellipses, contractions, numbers, imperative sentences and line breaks.
2. **Feel.** A hand-written lexicon maps words to nine tone dimensions: warmth, joy, melancholy, intensity, tension, wonder, gravity, formality and technical. Punctuation nudges the result (ellipses add melancholy and tension, capitals and exclamations add intensity). Negation is handled simply: "not happy" doesn't count as joy.
3. **Classify.** The text is read as one of: narrative, poetic, personal message, formal writing, instructions, promotional copy or general prose.
4. **Match.** Each of the 21 typefaces in the pool has trait scores on the same nine dimensions, plus *legibility* (stamina over long text) and *personality* (character in short bursts). The score compares the text's profile with each face, weighting the dimensions the text expresses most strongly. Faces suited to the intent get a small bonus, and faces that are wrong for it (a casual brush face for launch copy, for example) get a penalty. Long text rewards legibility; short text rewards personality.
5. **Set.** Size, leading, line length and weight follow from length and the face's own proportions.

Press **Enter** to set your text (**Shift+Enter** adds a new line). "Mark the words it reacted to" underlines the words that drove the reading.

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
src/lexicon.js    tone dimensions and word lists
src/analyze.js    text → tone profile, intent, length, evidence
src/fonts.js      typeface pool with trait scores
src/recommend.js  scoring, ranking and typesetting rules
src/app.js        UI
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

All typefaces are from Google Fonts under the SIL Open Font License. The code is MIT-licensed.
