import { redis } from "./redis.js";
import { getCardContentByDeck } from "./cards.js";
import type { CardContent } from "./types.js";

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

/** Topic menu — the grammar deck's content doubles as topic metadata (title_af/title_en). */
export async function listGrammarTopics(): Promise<{ cardId: string; content: CardContent }[]> {
  return getCardContentByDeck(GRAMMAR_DECK);
}
