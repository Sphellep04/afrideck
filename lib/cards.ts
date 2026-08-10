import { redis, cardKey } from "./redis.js";
import type { Card, ReviewLogEntry } from "./types.js";

export const DUE_INDEX_KEY = "due_index";

export function memberId(deck: string, cardId: string): string {
  return `${deck}:${cardId}`;
}

export function parseMemberId(member: string): { deck: string; cardId: string } {
  const [deck, ...rest] = member.split(":");
  return { deck, cardId: rest.join(":") };
}

function dateScore(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

function todayScore(): number {
  return dateScore(new Date().toISOString().slice(0, 10));
}

export async function getCard(deck: string, cardId: string): Promise<Card | null> {
  return redis.get<Card>(cardKey(deck, cardId));
}

export async function saveCard(deck: string, cardId: string, card: Card): Promise<void> {
  await redis.set(cardKey(deck, cardId), card);
  await redis.zadd(DUE_INDEX_KEY, { score: dateScore(card.next_review_date), member: memberId(deck, cardId) });
}

/** Returns one due (or overdue) card's member id, or null if nothing is due. */
export async function nextDueMember(): Promise<string | null> {
  const results = await redis.zrange<string[]>(DUE_INDEX_KEY, 0, todayScore(), {
    byScore: true,
    offset: 0,
    count: 1,
  });
  return results[0] ?? null;
}

export async function countDue(): Promise<number> {
  return redis.zcount(DUE_INDEX_KEY, "-inf", todayScore());
}

export async function logReview(member: string, rating: ReviewLogEntry["rating"]): Promise<void> {
  const entry: ReviewLogEntry = { card_id: member, rating };
  await redis.set(`review_log:${Date.now()}`, entry);
}
