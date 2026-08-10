import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN environment variable is not set");
}

export const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welkom by AfriDeck! 🇿🇦\n\n" +
      "I'll help you learn Afrikaans vocabulary with spaced repetition and pronunciation audio.\n\n" +
      "This is still phase 1 — more commands are on the way."
  );
});
