# AfriDeck 🇳🇦

A personal Afrikaans-learning Telegram bot with spaced repetition flashcards, grammar lessons, quizzes,
pronunciation audio, and free-form chat. Built entirely on free tiers.

## Screenshots

| | |
|---|---|
| ![Start message](docs/screenshots/start-message.jpg) | ![Review flow](docs/screenshots/review-flow.jpg) |
| `/start` | `/review`, one card at a time |
| ![Free chat advice](docs/screenshots/chat-advice.jpg) | ![Free chat on work vocabulary](docs/screenshots/chat-work-words.jpg) |
| Free chat: how to use the bot | Free chat: steering toward specific vocabulary |

## Features

- **`/review`**: SM-2 spaced repetition over a vocabulary deck (greetings, everyday, work) and a
  grammar deck, one card at a time
- **`/grammar`**: menu of 12 core Afrikaans grammar topics, each with a structured explanation and
  examples
- **`/quiz`**: multiple choice, kept separate from review scheduling so it doesn't distort timing
- **`/progress`**: cards mastered, due today, and a review streak
- **`/pronounce`, voice notes, `/recordings`**: reference pronunciation (cached TTS) and your own
  practice recordings, optional (needs Cloudflare R2)
- **Free chat**: anything that isn't a command gets a Groq-backed reply, with short-term memory per
  chat
- **Daily reminder**: a Vercel Cron job nudges you if cards are due

## Stack

Telegram Bot API · Vercel (serverless functions + cron) · Upstash Redis · Cloudflare R2 · Groq
(openai/gpt-oss-120b) · Google Translate TTS (unofficial)

## Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) → `BOT_TOKEN`
2. `npm install`, then copy `.env.example` → `.env` and fill in credentials:
   - `WEBHOOK_SECRET`: any random string
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: free Redis at [upstash.com](https://console.upstash.com/)
   - `GROQ_API_KEY`: free at [console.groq.com](https://console.groq.com/)
   - `R2_*`: optional, Cloudflare R2 for audio (needs a card on file even on the free tier)
   - `TELEGRAM_CHAT_ID` / `CRON_SECRET`: optional, for the daily reminder
3. Seed the vocabulary deck:
   ```
   npm run build-wordlist && npm run generate-sentences && npm run seed-redis
   ```
4. Seed the grammar deck:
   ```
   npm run generate-grammar-lessons && npm run seed-grammar
   ```
5. Deploy (`npx vercel --prod`, or connect the repo at vercel.com) and add the same env vars there
6. Register the webhook:
   ```
   WEBHOOK_URL=https://<your-deployment>/api/webhook npm run set-webhook
   ```

Everything except Redis degrades gracefully if unconfigured: audio and chat reply with a friendly
"not set up yet" instead of breaking anything else.

## Project layout

```
api/webhook.ts             Telegram webhook entrypoint
api/cron/daily-reminder.ts  Daily due-cards nudge
lib/bot.ts                 Command handlers and all bot flows
lib/cards.ts, sm2.ts        Card storage + SM-2 scheduling
lib/quiz.ts, chat.ts, grammar.ts, audio.ts, r2.ts, tts.ts, redis.ts, slug.ts, types.ts
scripts/                   One-off content generation and seeding scripts
data/                      Curated + generated deck content
```
