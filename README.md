# AfriDeck

Afrikaans vocabulary Telegram bot with spaced repetition (SM-2) and audio pronunciation.
Full plan: see the project plan doc. This repo currently implements all six phases: bot skeleton,
seed vocabulary, spaced repetition core, audio layer, quiz/progress, and the daily reminder cron.

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

5. **Register the webhook with Telegram** — `BOT_TOKEN`/`WEBHOOK_SECRET` load from `.env` automatically; only `WEBHOOK_URL` needs passing inline since it's deployment-specific:
   ```
   WEBHOOK_URL=https://afrideck.vercel.app/api/webhook npm run set-webhook
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

2. **Local + Vercel env vars** — add to your `.env` and, once deployed, `npx vercel env add` each (or
   Project Settings → Environment Variables): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
   `GROQ_API_KEY`. Upstash is needed everywhere; Groq is used both by the local seed script below
   *and* at runtime for free-form chat (see below), so it needs to be a Vercel env var too, not just
   local.

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

**This phase is optional at runtime.** Unlike the other services, Cloudflare has historically
required a payment card on file to activate R2 even within its free tier (10 GB storage, 1M writes/
month — no realistic personal usage would ever be billed, but it's a card on file regardless). If
you'd rather not add one yet, skip this section entirely: every other command works fine without
it, and `/pronounce`, voice note replies, and `/recordings` just reply with a "not set up yet"
message until R2 is configured.

1. **Create an R2 bucket** in the Cloudflare dashboard, and an API token
   (R2 → Manage API Tokens) scoped to that bucket for read/write access.

2. **Local + Vercel env vars** — add to your `.env` and, once deployed, `npx vercel env add` each:
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

## Free chat

Any message that isn't a recognized command falls through to a Groq-backed chat handler — ask it
about Afrikaans grammar, vocabulary, culture, or do short conversation practice. Per-chat history
(last 6 exchanges) is kept in Redis for 24h so it holds context across messages, rather than
treating each one in isolation. Uses `GROQ_API_KEY` (see Phase 2 setup); without it configured this
degrades to a "couldn't reply right now" message instead of breaking anything else.

## Grammar

`/grammar` shows a menu of 12 core Afrikaans grammar topics (word order, tenses, negation,
pronouns, plurals, diminutives, adjective agreement, prepositions, question words); picking one
shows a structured explanation with three examples. The same 12 topics also live as a `grammar`
deck reviewed through the normal `/review` SM-2 flow, so the rules resurface over time instead of
being a one-off read.

Content is Groq-generated the same way as the vocabulary deck, then **fact-checked by hand** — the
first generation pass had real errors (a hallucinated SOV word order that contradicted its own
examples, a false present-tense conjugation rule, a gender-agreement rule borrowed from Dutch that
doesn't apply to Afrikaans, etc.), corrected directly in `data/grammar-lessons.json` before seeding.
Worth a spot-check if you ever regenerate this content.

```
npm run generate-grammar-lessons   # calls Groq per topic, writes data/grammar-lessons.json
npm run seed-grammar                # loads topics into the grammar deck + lesson text into Redis
```

## Phase 5 — quiz and progress

- `/quiz` — a random card, multiple choice (correct translation + up to 3 distractors from other
  cards). Answering doesn't touch SM-2 scheduling at all — it's a separate ephemeral session (5 min
  TTL) keyed by chat id in Redis, purely for reinforcement.
- `/progress` — cards mastered (interval ≥ 21 days) out of the total deck, cards due today, and a
  review streak (consecutive days with at least one `/review` rating logged).

## Phase 6 setup — daily reminder

A Vercel Cron job runs once a day and messages you if any cards are due, so there's a nudge to open
the bot without relying on memory.

1. **Get your Telegram chat id** — message the bot once (e.g. `/start`), then visit
   `https://api.telegram.org/bot<token>/getUpdates` in a browser and read `message.chat.id` from the
   response.

2. **Local + Vercel env vars** — the cron job runs on Vercel, not locally, so these need to be set
   with `npx vercel env add <name>` (in addition to `.env` if you want to test the handler locally):
   - `TELEGRAM_CHAT_ID` — your chat id from step 1
   - `CRON_SECRET` — any random string you generate yourself; Vercel sends it back as a bearer token
     on every cron invocation, which the handler checks to reject requests to the (otherwise public)
     cron URL from anyone else

3. **Schedule** — set in `vercel.json` (`0 7 * * *`, 7am UTC by default; edit to taste — Vercel Cron
   runs in UTC and the Hobby plan allows at most once-daily invocations per job).

## Project layout

```
api/webhook.ts             Vercel function — Telegram webhook entrypoint
api/cron/daily-reminder.ts  Vercel Cron function — daily due-cards nudge
lib/bot.ts                 grammY bot instance, command handlers, /review, audio and quiz flows
lib/redis.ts                Upstash Redis client
lib/cards.ts                 Card storage, due-index, deck registry, mastery/streak stats
lib/sm2.ts                   SM-2 scheduling algorithm
lib/quiz.ts                  /quiz session logic (separate from SRS scheduling)
lib/chat.ts                   Groq-backed free chat fallback, per-chat history in Redis
lib/grammar.ts                Grammar topic/lesson storage + retrieval
lib/r2.ts                    Cloudflare R2 client (aws4fetch, S3-compatible)
lib/tts.ts                   Google Translate TTS (unofficial) helper
lib/audio.ts                 Reference audio caching + recording storage/listing
lib/slug.ts                  Shared word → card-id slug helper
lib/types.ts                 Card / review log types
scripts/set-webhook.ts      One-off script to register the webhook URL with Telegram
scripts/build-wordlist.ts   Cross-checks the curated word list against the Wiktionary export
scripts/generate-sentences.ts  Groq example-sentence generation
scripts/seed-redis.ts       Loads finished cards into Upstash Redis
scripts/generate-grammar-lessons.ts  Groq grammar lesson generation
scripts/seed-grammar.ts     Loads grammar topics into the grammar deck + lesson text
data/curated-words.json     Hand-picked 88-word/phrase seed list (greetings, everyday, work)
data/seed-words.json        Curated list + Wiktionary cross-check (generated)
data/seed-cards.json        Final cards with example sentences (generated)
data/grammar-topics.json    Curated 12-topic grammar list
data/grammar-lessons.json   Final grammar lessons (generated, hand-corrected)
vercel.json                 Cron schedule for the daily reminder
```

## Roadmap

- [x] Phase 1 — bot skeleton (`/start`)
- [x] Phase 2 — seed vocabulary from Wiktionary, loaded into Redis
- [x] Phase 3 — SM-2 spaced repetition core (`/review`)
- [x] Phase 4 — audio layer (R2 storage, `/pronounce`, voice note capture)
- [x] Phase 5 — `/quiz` and `/progress`
- [x] Phase 6 — daily reminder (cron)
