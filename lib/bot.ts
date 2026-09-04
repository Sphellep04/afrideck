import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import {
  countAllCards,
  countCardsPerDeck,
  countDue,
  countMastered,
  findCardByWord,
  getCardContent,
  getProgress,
  getReviewStreak,
  logReview,
  nextDueMember,
  parseMemberId,
  saveProgress,
} from "./cards.js";
import { applySM2, type Rating } from "./sm2.js";
import { getReferenceAudio, listRecordings, storeRecording } from "./audio.js";
import { getObject } from "./r2.js";
import { answerQuiz, startQuiz } from "./quiz.js";
import { chatReply } from "./chat.js";
import { getGrammarLesson, listGrammarTopics } from "./grammar.js";
import type { CardContent } from "./types.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN environment variable is not set");
}

export const bot = new Bot(token);

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Hello, 👋 welcome to AfriDeck, your personal bot by Phellep 🇳🇦.\n\n" +
      "Let us learn Afrikaans together, kom ons leer saam: vocabulary with spaced repetition, " +
      "grammar lessons, quizzes, and pronunciation audio.\n\n" +
      "Send /review to review the cards due today, /grammar for a grammar topic, /quiz to " +
      "test yourself, /progress for stats, /help for everything else, or just send a message " +
      "to chat."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "📚 Commands",
      "",
      "/review: review cards due today, spaced repetition (SM-2)",
      "/grammar: pick a grammar topic for a structured explanation",
      "/quiz: multiple-choice test, doesn't affect review scheduling",
      "/progress: cards mastered, due today, and your review streak",
      "/decks: see every deck and how many cards it has",
      "/pronounce <word>: hear a word's reference pronunciation",
      "/recordings <word>: replay your last 5 practice recordings for a word",
      "",
      "Reply to any card message with a voice note to save a practice recording for it.",
      "Anything else you type just goes to free chat: ask about grammar, vocabulary, or " +
        "practice a conversation.",
    ].join("\n")
  );
});

bot.command("decks", async (ctx) => {
  const [total, perDeck] = await Promise.all([countAllCards(), countCardsPerDeck()]);
  const lines = perDeck.map(({ deck, count }) => `${deck}: ${count}`);
  await ctx.reply(["📇 Decks", `Total: ${total} cards`, "", ...lines].join("\n"));
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

function frontText(content: CardContent): string {
  return `📇 ${content.afrikaans_word}`;
}

function backText(content: CardContent): string {
  const lines = [`📇 ${content.afrikaans_word}`, `🇬🇧 ${content.english_translation}`];
  if (content.example_sentence_af) {
    lines.push("", content.example_sentence_af);
    if (content.example_sentence_en) lines.push(content.example_sentence_en);
  }
  return lines.join("\n");
}

async function nextCardMessage(chatId: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const member = await nextDueMember(chatId);
  if (!member) {
    return { text: "No cards due right now. 🎉 Come back later!", keyboard: new InlineKeyboard() };
  }

  const { deck, cardId } = parseMemberId(member);
  const content = await getCardContent(deck, cardId);
  if (!content) {
    // due_index pointed at a card that no longer exists; skip it by asking the user to retry.
    return { text: "Ran into a stale card. Send /review again.", keyboard: new InlineKeyboard() };
  }

  return { text: frontText(content), keyboard: revealKeyboard(deck, cardId) };
}

bot.command("review", async (ctx) => {
  const due = await countDue(ctx.chat.id);
  if (due === 0) {
    await ctx.reply("No cards due today. 🎉 Come back tomorrow!");
    return;
  }
  const { text, keyboard } = await nextCardMessage(ctx.chat.id);
  await ctx.reply(text, { reply_markup: keyboard });
});

bot.callbackQuery(new RegExp(`^reveal:(${CARD_ID}):(${CARD_ID})$`), async (ctx) => {
  const [, deck, cardId] = ctx.match;
  const content = await getCardContent(deck, cardId);
  if (!content) {
    await ctx.answerCallbackQuery({ text: "Card not found." });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(backText(content), { reply_markup: ratingKeyboard(deck, cardId) });
});

bot.callbackQuery(new RegExp(`^rate:(again|hard|good|easy):(${CARD_ID}):(${CARD_ID})$`), async (ctx) => {
  if (!ctx.chat) {
    await ctx.answerCallbackQuery();
    return;
  }
  const chatId = ctx.chat.id;
  const [, rating, deck, cardId] = ctx.match;

  const progress = await getProgress(chatId, deck, cardId);
  if (!progress) {
    await ctx.answerCallbackQuery({ text: "Card not found." });
    return;
  }

  const updated = applySM2(progress, rating as Rating);
  await saveProgress(chatId, deck, cardId, updated);
  await logReview(chatId, `${deck}:${cardId}`, rating as Rating);
  await ctx.answerCallbackQuery({
    text: rating === "again" ? "Again, back to day 1" : `Next review in ${updated.interval_days}d`,
  });

  const { text, keyboard } = await nextCardMessage(chatId);
  await ctx.editMessageText(text, { reply_markup: keyboard });
});

const AUDIO_UNAVAILABLE_MESSAGE =
  "Audio isn't set up yet (Cloudflare R2 not configured). This will work once that's added.";

/** Audio (Phase 4) is optional infra; failures here shouldn't break the rest of the bot. */
async function withAudioFallback(ctx: Context, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    console.error("Audio feature failed:", err);
    await ctx.reply(AUDIO_UNAVAILABLE_MESSAGE);
  }
}

async function sendPronunciation(ctx: Context, deck: string, cardId: string, content: CardContent): Promise<void> {
  const audio = await getReferenceAudio(deck, cardId, content);
  await ctx.replyWithAudio(new InputFile(audio, `${cardId}.mp3`), { title: content.afrikaans_word });
}

bot.callbackQuery(new RegExp(`^pronounce:(${CARD_ID}):(${CARD_ID})$`), async (ctx) => {
  const [, deck, cardId] = ctx.match;
  const content = await getCardContent(deck, cardId);
  if (!content) {
    await ctx.answerCallbackQuery({ text: "Card not found." });
    return;
  }
  await ctx.answerCallbackQuery({ text: "Generating audio…" });
  await withAudioFallback(ctx, () => sendPronunciation(ctx, deck, cardId, content));
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

  await withAudioFallback(ctx, () => sendPronunciation(ctx, found.deck, found.cardId, found.content));
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
    await ctx.reply("Couldn't download that voice note. Try again.");
    return;
  }

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  const audio = new Uint8Array(await res.arrayBuffer());

  await withAudioFallback(ctx, async () => {
    await storeRecording(ctx.chat.id, found.deck, found.cardId, audio);
    await ctx.reply(
      `Saved your recording for "${found.content.afrikaans_word}". Send /recordings ${found.content.afrikaans_word} to hear past attempts.`
    );
  });
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

  await withAudioFallback(ctx, async () => {
    const recordings = await listRecordings(ctx.chat.id, found.deck, found.cardId);
    if (recordings.length === 0) {
      await ctx.reply(
        `No recordings yet for "${found.content.afrikaans_word}". Reply to a card message with a voice note to add one.`
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
});

bot.command("quiz", async (ctx) => {
  const question = await startQuiz(ctx.chat.id);
  if (!question) {
    await ctx.reply("No cards to quiz on yet. Seed the deck first.");
    return;
  }

  const keyboard = new InlineKeyboard();
  question.choices.forEach((choice, i) => {
    keyboard.text(choice, `quizans:${i}`).row();
  });

  await ctx.reply(`❓ What does "${question.afrikaans_word}" mean?`, { reply_markup: keyboard });
});

bot.callbackQuery(/^quizans:([0-3])$/, async (ctx) => {
  if (!ctx.chat) {
    await ctx.answerCallbackQuery();
    return;
  }
  const chosenIndex = Number(ctx.match[1]);
  const result = await answerQuiz(ctx.chat.id, chosenIndex);
  if (!result) {
    await ctx.answerCallbackQuery({ text: "This quiz expired. Send /quiz for a new one." });
    return;
  }

  await ctx.answerCallbackQuery({ text: result.correct ? "✅ Correct!" : "❌ Not quite" });
  await ctx.editMessageText(
    `${result.correct ? "✅" : "❌"} ${result.afrikaans_word} → ${result.correctAnswer}`
  );
});

bot.command("progress", async (ctx) => {
  const chatId = ctx.chat.id;
  const [total, due, mastered, streak] = await Promise.all([
    countAllCards(),
    countDue(chatId),
    countMastered(chatId),
    getReviewStreak(chatId),
  ]);

  await ctx.reply(
    [
      "📊 Progress",
      `Cards mastered: ${mastered}/${total}`,
      `Due today: ${due}`,
      `Review streak: ${streak} day${streak === 1 ? "" : "s"}`,
    ].join("\n")
  );
});

bot.command("grammar", async (ctx) => {
  const topics = await listGrammarTopics();
  if (topics.length === 0) {
    await ctx.reply("No grammar topics loaded yet.");
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const { cardId, content } of topics) {
    keyboard.text(content.afrikaans_word, `grammar:${cardId}`).row();
  }

  await ctx.reply("📖 Pick a grammar topic:", { reply_markup: keyboard });
});

bot.callbackQuery(new RegExp(`^grammar:(${CARD_ID})$`), async (ctx) => {
  const [, cardId] = ctx.match;
  const [content, lesson] = await Promise.all([getCardContent("grammar", cardId), getGrammarLesson(cardId)]);
  if (!content || !lesson) {
    await ctx.answerCallbackQuery({ text: "Topic not found." });
    return;
  }

  await ctx.answerCallbackQuery();
  const lines = [
    `📖 ${content.afrikaans_word} (${content.english_translation})`,
    "",
    lesson.explanation,
    "",
    ...lesson.examples.flatMap((e) => [`${e.af}`, `${e.en}`, ""]),
  ];
  await ctx.editMessageText(lines.join("\n").trim());
});

// Fallback for anything that isn't a recognized command — must stay last so it only
// catches messages every handler above didn't already consume.
bot.on("message:text", async (ctx) => {
  try {
    await ctx.replyWithChatAction("typing");
    const reply = await chatReply(ctx.chat.id, ctx.message.text);
    await ctx.reply(reply);
  } catch (err) {
    console.error("Chat reply failed:", err);
    await ctx.reply("Sorry, I couldn't reply to that right now. Try again in a moment.");
  }
});
