import { Bot, InlineKeyboard } from "grammy";
import { countDue, getCard, logReview, nextDueMember, parseMemberId, saveCard } from "./cards.js";
import { applySM2, type Rating } from "./sm2.js";
import type { Card } from "./types.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN environment variable is not set");
}

export const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welkom by AfriDeck! 🇿🇦\n\n" +
      "I'll help you learn Afrikaans vocabulary with spaced repetition and pronunciation audio.\n\n" +
      "Send /review to review the cards due today."
  );
});

const CARD_ID = "[a-z0-9-]+";

function revealKeyboard(deck: string, cardId: string): InlineKeyboard {
  return new InlineKeyboard().text("Show answer", `reveal:${deck}:${cardId}`);
}

function ratingKeyboard(deck: string, cardId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Again", `rate:again:${deck}:${cardId}`)
    .text("Hard", `rate:hard:${deck}:${cardId}`)
    .text("Good", `rate:good:${deck}:${cardId}`)
    .text("Easy", `rate:easy:${deck}:${cardId}`);
}

function frontText(card: Card): string {
  return `📇 ${card.afrikaans_word}`;
}

function backText(card: Card): string {
  const lines = [`📇 ${card.afrikaans_word}`, `🇬🇧 ${card.english_translation}`];
  if (card.example_sentence_af) {
    lines.push("", card.example_sentence_af);
    if (card.example_sentence_en) lines.push(card.example_sentence_en);
  }
  return lines.join("\n");
}

async function nextCardMessage(): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const member = await nextDueMember();
  if (!member) {
    return { text: "No cards due right now. 🎉 Come back later!", keyboard: new InlineKeyboard() };
  }

  const { deck, cardId } = parseMemberId(member);
  const card = await getCard(deck, cardId);
  if (!card) {
    // due_index pointed at a card that no longer exists; skip it by asking the user to retry.
    return { text: "Ran into a stale card — send /review again.", keyboard: new InlineKeyboard() };
  }

  return { text: frontText(card), keyboard: revealKeyboard(deck, cardId) };
}

bot.command("review", async (ctx) => {
  const due = await countDue();
  if (due === 0) {
    await ctx.reply("No cards due today. 🎉 Come back tomorrow!");
    return;
  }
  const { text, keyboard } = await nextCardMessage();
  await ctx.reply(text, { reply_markup: keyboard });
});

bot.callbackQuery(new RegExp(`^reveal:(${CARD_ID}):(${CARD_ID})$`), async (ctx) => {
  const [, deck, cardId] = ctx.match;
  const card = await getCard(deck, cardId);
  if (!card) {
    await ctx.answerCallbackQuery({ text: "Card not found." });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(backText(card), { reply_markup: ratingKeyboard(deck, cardId) });
});

bot.callbackQuery(new RegExp(`^rate:(again|hard|good|easy):(${CARD_ID}):(${CARD_ID})$`), async (ctx) => {
  const [, rating, deck, cardId] = ctx.match;
  const card = await getCard(deck, cardId);
  if (!card) {
    await ctx.answerCallbackQuery({ text: "Card not found." });
    return;
  }

  const updated = applySM2(card, rating as Rating);
  await saveCard(deck, cardId, updated);
  await logReview(`${deck}:${cardId}`, rating as Rating);
  await ctx.answerCallbackQuery({
    text: rating === "again" ? "Again — back to day 1" : `Next review in ${updated.interval_days}d`,
  });

  const { text, keyboard } = await nextCardMessage();
  await ctx.editMessageText(text, { reply_markup: keyboard });
});
