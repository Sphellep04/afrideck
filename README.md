# AfriDeck

Afrikaans vocabulary Telegram bot with spaced repetition (SM-2) and audio pronunciation.
Full plan: see the project plan doc. This repo currently implements **Phase 1: bot skeleton**.

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

## Project layout

```
api/webhook.ts     Vercel function — Telegram webhook entrypoint
lib/bot.ts         grammY bot instance and command handlers
scripts/set-webhook.ts   One-off script to register the webhook URL with Telegram
```

## Roadmap

- [x] Phase 1 — bot skeleton (`/start`)
- [ ] Phase 2 — seed vocabulary from Wiktionary, loaded into Redis
- [ ] Phase 3 — SM-2 spaced repetition core (`/review`)
- [ ] Phase 4 — audio layer (R2 storage, `/pronounce`, voice note capture)
- [ ] Phase 5 — `/quiz` and `/progress`
- [ ] Phase 6 — daily reminder (cron)
