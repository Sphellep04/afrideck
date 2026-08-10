import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import {
  countDue,
  findCardByWord,
  getCard,
  logReview,
  nextDueMember,
  parseMemberId,
  saveCard,
} from "./cards.js";
import { applySM2, type Rating } from "./sm2.js";
import { getReferenceAudio, listRecordings, storeRecording } from "./audio.js";
import { getObject } from "./r2.js";
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
  return new InlineKeyboard()
    .text("🔊 Pronounce", `pronounce:${deck}:${cardId}`)
    .text("Show answer", `reveal:${deck}:${cardId}`);
}

function ratingKeyboard(deck: string, cardId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔊 Pronounce", `pronounce:${deck}:${cardId}`)
    .row()
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

async function sendPronunciation(ctx: Context, deck: string, cardId: string, card: Card): Promise<void> {
  const audio = await getReferenceAudio(deck, cardId, card);
  await ctx.replyWithAudio(new InputFile(audio, `${cardId}.mp3`), { title: card.afrikaans_word });
}

bot.callbackQuery(new RegExp(`^pronounce:(${CARD_ID}):(${CARD_ID})$`), async (ctx) => {
  const [, deck, cardId] = ctx.match;
  const card = await getCard(deck, cardId);
  if (!card) {
    await ctx.answerCallbackQuery({ text: "Card not found." });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Generating audio…" });
  await sendPronunciation(ctx, deck, cardId, card);
});

bot.command("pronounce", async (ctx) => {
  const word = ctx.match.trim();
  if (!word) {
    await ctx.reply("Usage: /pronounce <afrikaans word or phrase>");
    return;
  }

  const found = await findCardByWord(word);
  if (!found) {
    await ctx.reply(`Couldn't find a card for "${word}".`);
    return;
  }

  await sendPronunciation(ctx, found.deck, found.cardId, found.card);
});

function extractWordFromCardMessage(text: string): string | null {
  const firstLine = text.split("\n")[0];
  const match = /^📇\s*(.+)$/u.exec(firstLine);
  return match ? match[1].trim() : null;
}

bot.on("message:voice", async (ctx) => {
  const replyText = ctx.message.reply_to_message?.text;
  const word = replyText ? extractWordFromCardMessage(replyText) : null;
  if (!word) {
    await ctx.reply(
      "Reply to a card message (from /review or /pronounce) with your voice note to save it against that word."
    );
    return;
  }

  const found = await findCardByWord(word);
  if (!found) {
    await ctx.reply(`Couldn't match that message to a card.`);
    return;
  }

  const file = await ctx.getFile();
  if (!file.file_path) {
    await ctx.reply("Couldn't download that voice note — try again.");
    return;
  }

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  const audio = new Uint8Array(await res.arrayBuffer());
  await storeRecording(found.deck, found.cardId, audio);

  await ctx.reply(
    `Saved your recording for "${found.card.afrikaans_word}". Send /recordings ${found.card.afrikaans_word} to hear past attempts.`
  );
});

bot.command("recordings", async (ctx) => {
  const word = ctx.match.trim();
  if (!word) {
    await ctx.reply("Usage: /recordings <afrikaans word or phrase>");
    return;
  }

  const found = await findCardByWord(word);
  if (!found) {
    await ctx.reply(`Couldn't find a card for "${word}".`);
    return;
  }

  const recordings = await listRecordings(found.deck, found.cardId);
  if (recordings.length === 0) {
    await ctx.reply(
      `No recordings yet for "${found.card.afrikaans_word}". Reply to a card message with a voice note to add one.`
    );
    return;
  }

  const recent = recordings.slice(-5);
  for (const rec of recent) {
    const audio = await getObject(rec.key);
    if (!audio) continue;
    await ctx.replyWithVoice(new InputFile(audio, "recording.ogg"), { caption: rec.lastModified });
  }
});
