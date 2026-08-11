import { redis } from "./redis.js";
import { getCardsByDeck } from "./cards.js";
import type { Card } from "./types.js";

export const GRAMMAR_DECK = "grammar";

export interface GrammarExample {
  af: string;
  en: string;
}

export interface GrammarLesson {
  explanation: string;
  examples: GrammarExample[];
}

function lessonKey(cardId: string): string {
  return `grammar_lesson:${cardId}`;
}

export async function saveGrammarLesson(cardId: string, lesson: GrammarLesson): Promise<void> {
  await redis.set(lessonKey(cardId), lesson);
}

export async function getGrammarLesson(cardId: string): Promise<GrammarLesson | null> {
  return redis.get<GrammarLesson>(lessonKey(cardId));
}

/** Topic menu — the grammar deck's cards double as topic metadata (title_af/title_en). */
export async function listGrammarTopics(): Promise<{ cardId: string; card: Card }[]> {
  return getCardsByDeck(GRAMMAR_DECK);
}
