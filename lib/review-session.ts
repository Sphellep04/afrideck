import { redis } from "./redis.js";

const ACTIVE_CARD_TTL_SECONDS = 600;

export interface ActiveCard {
  deck: string;
  cardId: string;
  afrikaans_word: string;
  english_translation: string;
}

function activeCardKey(chatId: number): string {
  return `active_card:${chatId}`;
}

/** Remembers the card a user was just shown, so a free-text reply can be graded in context. */
export async function setActiveCard(chatId: number, card: ActiveCard): Promise<void> {
  await redis.set(activeCardKey(chatId), card, { ex: ACTIVE_CARD_TTL_SECONDS });
}

export async function getActiveCard(chatId: number): Promise<ActiveCard | null> {
  return redis.get<ActiveCard>(activeCardKey(chatId));
}
