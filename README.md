# AfriDeck

Afrikaans vocabulary Telegram bot with spaced repetition (SM-2) and audio pronunciation.
Full plan: see the project plan doc. This repo currently implements **Phase 1 (bot skeleton)**,
**Phase 2 (seed vocabulary)**, **Phase 3 (spaced repetition core)**, and **Phase 4 (audio layer)**.

## Stack

Telegram Bot API · Vercel (serverless functions) · Upstash Redis · Cloudflare R2 · Groq/Llama · Google Translate TTS (unofficial, fallback `espeak-ng`)

## Phase 1 setup

1. **Create the bot**
   - Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, follow the prompts.
   - Save the bot token it gives you.

2. **Install dependencies**
   ```
   npm install
   ```

3. **Local env vars** — copy `.env.example` to `.env` and fill in:
   - `BOT_TOKEN` — from BotFather
   - `WEBHOOK_SECRET` — any random string you generate yourself (used to verify requests really come from Telegram)

4. **Deploy to Vercel**
   ```
   npx vercel login
   npx vercel link
   npx vercel env add BOT_TOKEN
   npx vercel env add WEBHOOK_SECRET
   npx vercel --prod
   ```
   Note the deployment URL, e.g. `https://afrideck.vercel.app`.

5. **Register the webhook with Telegram**
   ```
   BOT_TOKEN=xxx WEBHOOK_SECRET=xxx WEBHOOK_URL=https://afrideck.vercel.app/api/webhook npm run set-webhook
   ```
   This tells Telegram to POST every update to your Vercel function.

6. **Test it** — message your bot `/start` on Telegram. It should reply with a welcome message.

## Phase 2 setup — seed vocabulary

Populates Redis with an initial deck: 88 words/phrases across three decks (greetings, everyday, work),
sourced from the [Wiktionary Afrikaans export](https://kaikki.org/dictionary/Afrikaans/) (CC-licensed)
with Groq-generated example sentences.

1. **Get free credentials**
   - [Upstash](https://console.upstash.com/) — create a Redis database (free tier, no card), copy the REST URL and token.
   - [Groq](https://console.groq.com/) — create an API key (free tier, no card).

2. **Local env vars** — add to your `.env`:
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — from the Upstash console
   - `GROQ_API_KEY` — from the Groq console

3. **Download the Wiktionary Afrikaans export** into `data/wiktionary-afrikaans-raw.jsonl` (not committed, ~13 MB):
   ```
   curl -o data/wiktionary-afrikaans-raw.jsonl https://kaikki.org/dictionary/Afrikaans/kaikki.org-dictionary-Afrikaans.jsonl
   ```

4. **Build and cross-check the word list** — `data/curated-words.json` is the hand-picked 88-word/phrase
   list across the three decks; this cross-checks each single-word entry against the Wiktionary export
   and writes `data/seed-words.json`:
   ```
   npm run build-wordlist
   ```

5. **Generate example sentences** — calls Groq once per word for a natural Afrikaans example sentence
   and a confirmed English translation, writes `data/seed-cards.json`:
   ```
   npm run generate-sentences
   ```

6. **Seed Redis** — loads every card into Redis (`card:{deck}:{card_id}`) and the `due_index` sorted set,
   all due today:
   ```
   npm run seed-redis
   ```

## Phase 3 — reviewing

Send `/review` to work through every card due today, one at a time: `/review` shows the Afrikaans
word, "Show answer" reveals the translation and example sentence, then Again/Hard/Good/Easy rates
the card. Rating applies the SM-2 update (interval + ease factor), logs the review, and immediately
shows the next due card — or a "no cards due" message once the queue is empty. No session state is
kept between requests; each step just re-reads the due index, so it's safe across serverless
invocations.

## Phase 4 setup — audio

Reference pronunciation is generated once per word (unofficial Google Translate TTS endpoint) and
cached in Cloudflare R2; your own practice recordings are captured from Telegram voice notes and
stored alongside it.

1. **Create an R2 bucket** in the Cloudflare dashboard (free tier, no card), and an API token
   (R2 → Manage API Tokens) scoped to that bucket for read/write access.

2. **Local env vars** — add to your `.env`:
   - `R2_ACCOUNT_ID` — your Cloudflare account ID
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — from the R2 API token
   - `R2_BUCKET` — the bucket name

3. **Usage**
   - `🔊 Pronounce` button on any card during `/review`, or `/pronounce <word>` standalone —
     generates (first time) or replays (cached) the reference audio for a word.
   - Reply to any card message with a voice note to save it as a practice recording, tagged to
     that word.
   - `/recordings <word>` — replays your last 5 saved recordings for that word.

   The TTS endpoint is unofficial and keyless, so it could change or stop working without notice;
   the documented fallback is `espeak-ng` (self-hosted, not yet wired up here).

## Project layout

```
api/webhook.ts             Vercel function — Telegram webhook entrypoint
lib/bot.ts                 grammY bot instance, command handlers, /review and audio flows
lib/redis.ts                Upstash Redis client
lib/cards.ts                 Card storage, due-index (sorted set) and deck-registry helpers
lib/sm2.ts                   SM-2 scheduling algorithm
lib/r2.ts                    Cloudflare R2 client (aws4fetch, S3-compatible)
lib/tts.ts                   Google Translate TTS (unofficial) helper
lib/audio.ts                 Reference audio caching + recording storage/listing
lib/slug.ts                  Shared word → card-id slug helper
lib/types.ts                 Card / review log types
scripts/set-webhook.ts      One-off script to register the webhook URL with Telegram
scripts/build-wordlist.ts   Cross-checks the curated word list against the Wiktionary export
scripts/generate-sentences.ts  Groq example-sentence generation
scripts/seed-redis.ts       Loads finished cards into Upstash Redis
data/curated-words.json     Hand-picked 88-word/phrase seed list (greetings, everyday, work)
data/seed-words.json        Curated list + Wiktionary cross-check (generated)
data/seed-cards.json        Final cards with example sentences (generated)
```

## Roadmap

- [x] Phase 1 — bot skeleton (`/start`)
- [x] Phase 2 — seed vocabulary from Wiktionary, loaded into Redis
- [x] Phase 3 — SM-2 spaced repetition core (`/review`)
- [x] Phase 4 — audio layer (R2 storage, `/pronounce`, voice note capture)
- [ ] Phase 5 — `/quiz` and `/progress`
- [ ] Phase 6 — daily reminder (cron)
