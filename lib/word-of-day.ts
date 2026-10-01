import { redis } from "./redis.js";
import { getAllCardContent } from "./cards.js";
import { GRAMMAR_DECK } from "./grammar.js";
import type { CardContent } from "./types.js";

function explanationKey(deck: string, cardId: string): string {
  return `word_of_day_explanation:${deck}:${cardId}`;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - start) / (1000 * 60 * 60 * 24));
}

export interface WordOfDay {
  deck: string;
  cardId: string;
  content: CardContent;
  explanation: string;
}

/** Same word for everyone on a given day: rotates through the vocab catalog (not grammar) by day of year. */
async function getWordOfDayCard(): Promise<{ deck: string; cardId: string; content: CardContent } | null> {
  const all = (await getAllCardContent())
    .filter((c) => c.deck !== GRAMMAR_DECK)
    .sort((a, b) => `${a.deck}:${a.cardId}`.localeCompare(`${b.deck}:${b.cardId}`));
  if (all.length === 0) return null;
  return all[dayOfYear(new Date()) % all.length];
}

async function generateExplanation(content: CardContent): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set");
  }

  const prompt =
    `You are an Afrikaans tutor. Write a short, detailed explanation of the Afrikaans word or phrase ` +
    `"${content.afrikaans_word}" (meaning "${content.english_translation}") for an English-speaking learner, ` +
    "covering only: (1) a one-sentence restatement of its meaning, (2) one sentence on when it's typically " +
    "used (e.g. casual conversation, formal writing, a specific everyday situation), and (3) one additional " +
    `natural example sentence beyond "${content.example_sentence_af}" with its English translation. Do not ` +
    "introduce any other Afrikaans vocabulary, synonyms, alternative/formal forms, or etymology, every other " +
    "word you mention is a likely source of error and must be avoided. Afrikaans has no grammatical gender " +
    "(no masculine/feminine/neuter nouns) and only one definite article, 'die', for every noun; do not claim " +
    "otherwise. Do not use em dashes or en dashes; use commas or periods instead.";

  const body = JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
  });
  const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
  const url = "https://api.groq.com/openai/v1/chat/completions";

  let res = await fetch(url, { method: "POST", headers, body });
  // Token-per-minute limits are easy to hit with these longer completions; back off and retry
  // (up to twice) rather than just failing, since the limit window is short (resets within
  // seconds), with each wait longer than the last in case the window is still busy.
  for (const waitMs of [15000, 25000]) {
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await fetch(url, { method: "POST", headers, body });
  }

  if (!res.ok) {
    throw new Error(`Groq request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("No content in Groq response");
  }
  return cleanExplanation(text);
}

const FALSE_GENDER_CLAIM = /\b(masculine|feminine|neuter)\b/i;

/**
 * The instruction against claiming Afrikaans has grammatical gender isn't reliably honored
 * either (confirmed live: it just swapped "masculine" for "neuter", still wrong). Afrikaans
 * genuinely has none, so any sentence asserting otherwise is always safe to drop outright
 * rather than trusting the prompt alone, same reasoning as the em/en dash strip.
 */
function cleanExplanation(text: string): string {
  const noDashes = text.replace(/ ?[—–] ?/g, ", ");
  const sentences = noDashes.split(/(?<=[.!?])\s+/).filter((s) => !FALSE_GENDER_CLAIM.test(s));
  return sentences.join(" ").replace(/ {2,}/g, " ").trim();
}

/** Detailed explanation for a word, generated once via Groq and cached forever (content never changes). */
export async function getWordExplanation(deck: string, cardId: string, content: CardContent): Promise<string> {
  const key = explanationKey(deck, cardId);
  const cached = await redis.get<string>(key);
  if (cached) return cached;

  const explanation = await generateExplanation(content);
  await redis.set(key, explanation);
  return explanation;
}

export async function getWordOfDay(): Promise<WordOfDay | null> {
  const card = await getWordOfDayCard();
  if (!card) return null;
  const explanation = await getWordExplanation(card.deck, card.cardId, card.content);
  return { ...card, explanation };
}

export function formatWordOfDay(word: WordOfDay): string {
  return [
    `📖 Word of the day: ${word.content.afrikaans_word} (${word.content.english_translation})`,
    "",
    word.explanation,
  ].join("\n");
}
