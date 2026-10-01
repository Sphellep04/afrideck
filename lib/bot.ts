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
  suggestCards,
} from "./cards.js";
import { applySM2, type Rating } from "./sm2.js";
import { getReferenceAudio, listRecordings, storeRecording } from "./audio.js";
import { getObject, isR2Configured } from "./r2.js";
import { answerQuiz, startQuiz } from "./quiz.js";
import { chatReply } from "./chat.js";
import { formatGrammarLesson, getGrammarLesson, GRAMMAR_DECK, listGrammarTopics } from "./grammar.js";
import { getActiveCard, setActiveCard } from "./review-session.js";
import { formatWordOfDay, getWordOfDay } from "./word-of-day.js";
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
      "/word: today's word of the day, with a detailed explanation",
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

bot.command("word", async (ctx) => {
  const word = await getWordOfDay();
  if (!word) {
    await ctx.reply("No word of the day yet, seed the deck first.");
    return;
  }
  await ctx.reply(formatWordOfDay(word));
});

const CARD_ID = "[a-z0-9-]+";

function revealKeyboard(deck: string, cardId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (isR2Configured()) keyboard.text("🔊 Pronounce", `pronounce:${deck}:${cardId}`);
  return keyboard.text("Show answer", `reveal:${deck}:${cardId}`);
}

/**
 * Just two outcomes (good/again), matching what reply-grading already produces, rather than
 * SM-2's full Again/Hard/Good/Easy nuance - the rate callback still accepts all four values
 * (so any already-sent card message with the old 4-button layout keeps working), only the
 * buttons rendered on new cards changed.
 */
function ratingKeyboard(deck: string, cardId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (isR2Configured()) keyboard.text("🔊 Pronounce", `pronounce:${deck}:${cardId}`).row();
  return keyboard
    .text("❌ Missed it", `rate:again:${deck}:${cardId}`)
    .text("✅ Got it", `rate:good:${deck}:${cardId}`);
}

function frontText(content: CardContent): string {
  return `📇 ${content.afrikaans_word}`;
}

/**
 * Grammar cards get the full structured lesson (same as /grammar) rather than just the title
 * and one example, since that's the whole point of reviewing one.
 */
async function backText(deck: string, cardId: string, content: CardContent): Promise<string> {
  if (deck === GRAMMAR_DECK) {
    const lesson = await getGrammarLesson(cardId);
    if (lesson) return formatGrammarLesson(content, lesson);
  }

  const lines = [`📇 ${content.afrikaans_word}`, `🇬🇧 ${content.english_translation}`];
  if (content.example_sentence_af) {
    lines.push("", content.example_sentence_af);
    if (content.example_sentence_en) lines.push(content.example_sentence_en);
  }
  return lines.join("\n");
}

async function nextCardMessage(chatId: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const [member, due] = await Promise.all([nextDueMember(chatId), countDue(chatId)]);
  if (!member) {
    return { text: "No cards due right now. 🎉 Come back later!", keyboard: new InlineKeyboard() };
  }

  const { deck, cardId } = parseMemberId(member);
  const content = await getCardContent(deck, cardId);
  if (!content) {
    // due_index pointed at a card that no longer exists; skip it by asking the user to retry.
    return { text: "Ran into a stale card. Send /review again.", keyboard: new InlineKeyboard() };
  }

  await setActiveCard(chatId, {
    deck,
    cardId,
    afrikaans_word: content.afrikaans_word,
    english_translation: content.english_translation,
  });

  const remaining = `${due} card${due === 1 ? "" : "s"} left today`;
  const hint = "Reply with your answer to grade it automatically, or tap a button below.";
  return {
    text: `${frontText(content)}\n\n${remaining}\n${hint}`,
    keyboard: revealKeyboard(deck, cardId),
  };
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
  const text = await backText(deck, cardId, content);
  await ctx.editMessageText(text, { reply_markup: ratingKeyboard(deck, cardId) });
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

async function notFoundReply(ctx: Context, word: string): Promise<void> {
  const suggestions = await suggestCards(word);
  if (suggestions.length === 0) {
    await ctx.reply(`Couldn't find a card for "${word}".`);
    return;
  }
  const names = suggestions.map((s) => `"${s.content.afrikaans_word}"`).join(", ");
  await ctx.reply(`Couldn't find a card for "${word}". Did you mean: ${names}?`);
}

bot.command("pronounce", async (ctx) => {
  const word = ctx.match.trim();
  if (!word) {
    await ctx.reply("Usage: /pronounce <afrikaans word or phrase>");
    return;
  }

  const found = await findCardByWord(word);
  if (!found) {
    await notFoundReply(ctx, word);
    return;
  }

  await withAudioFallback(ctx, () => sendPronunciation(ctx, found.deck, found.cardId, found.content));
});

function extractWordFromCardMessage(text: string): string | null {
  const firstLine = text.split("\n")[0];
  const match = /^[📇📖]\s*(.+)$/u.exec(firstLine);
  if (!match) return null;
  // Grammar's back text is "📖 word (translation)"; strip the trailing parenthetical if present.
  return match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
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
    await notFoundReply(ctx, word);
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
  const [content, lesson] = await Promise.all([getCardContent(GRAMMAR_DECK, cardId), getGrammarLesson(cardId)]);
  if (!content || !lesson) {
    await ctx.answerCallbackQuery({ text: "Topic not found." });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(formatGrammarLesson(content, lesson));
});

function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/[.,!?'"]/g, "").trim();
}

/**
 * Deliberately conservative: only true if the user's answer contains one of the correct senses
 * as a substring (handles "it means small", "small.", "Small" etc). Doesn't check the reverse
 * direction (correct sense containing the user's answer), since that would let a short partial
 * guess like "s" match "small" - under-crediting a synonym is a safer failure than
 * over-crediting a near-miss.
 */
function isAnswerCorrect(userAnswer: string, correctTranslation: string): boolean {
  const answer = normalizeAnswer(userAnswer);
  if (!answer) return false;
  const senses = correctTranslation
    .split("/")
    .map((s) => normalizeAnswer(s))
    .filter(Boolean);
  return senses.some((sense) => answer.includes(sense));
}

/**
 * A free-text reply to a card message is treated as a deliberate answer attempt (same
 * "reply to the card = this is about that card" convention already used for voice notes), and
 * gets graded and auto-rated (good/again) instead of just chatted about. Returns true if it
 * handled the message, so the caller knows not to also fall through to free chat.
 */
async function tryGradeReply(ctx: Context & { message: { text: string } }): Promise<boolean> {
  if (!ctx.chat) return false;
  const replyText = ctx.message.reply_to_message?.text;
  const word = replyText ? extractWordFromCardMessage(replyText) : null;
  if (!word) return false;

  const found = await findCardByWord(word);
  if (!found) return false;

  const chatId = ctx.chat.id;
  const progress = await getProgress(chatId, found.deck, found.cardId);
  if (!progress) return false;

  const correct = isAnswerCorrect(ctx.message.text, found.content.english_translation);
  const rating: Rating = correct ? "good" : "again";
  const updated = applySM2(progress, rating);
  await saveProgress(chatId, found.deck, found.cardId, updated);
  await logReview(chatId, `${found.deck}:${found.cardId}`, rating);

  const verdict = correct
    ? `✅ Correct, "${found.content.afrikaans_word}" means "${found.content.english_translation}".`
    : `❌ Not quite, "${found.content.afrikaans_word}" means "${found.content.english_translation}".`;
  await ctx.reply(verdict);

  const { text, keyboard } = await nextCardMessage(chatId);
  await ctx.reply(text, { reply_markup: keyboard });
  return true;
}

// Fallback for anything that isn't a recognized command — must stay last so it only
// catches messages every handler above didn't already consume.
bot.on("message:text", async (ctx) => {
  try {
    if (await tryGradeReply(ctx)) return;

    await ctx.replyWithChatAction("typing");
    const activeCard = await getActiveCard(ctx.chat.id);
    const reply = await chatReply(ctx.chat.id, ctx.message.text, activeCard ?? undefined);
    await ctx.reply(reply);
  } catch (err) {
    console.error("Chat reply failed:", err);
    await ctx.reply("Sorry, I couldn't reply to that right now. Try again in a moment.");
  }
});
