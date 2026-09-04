import { redis } from "./redis.js";
import { slugify } from "./slug.js";
import type { CardContent, CardProgress, ReviewLogEntry } from "./types.js";

const DECKS_KEY = "decks";
const ALL_CARDS_KEY = "all_cards";
const USERS_KEY = "users";

function contentKey(deck: string, cardId: string): string {
  return `card_content:${deck}:${cardId}`;
}

function progressKey(chatId: number, deck: string, cardId: string): string {
  return `progress:${chatId}:${deck}:${cardId}`;
}

function dueIndexKey(chatId: number): string {
  return `due_index:${chatId}`;
}

function enrolledKey(chatId: number): string {
  return `enrolled:${chatId}`;
}

function reviewDatesKey(chatId: number): string {
  return `review_dates:${chatId}`;
}

function newCardsTodayKey(chatId: number, date: string): string {
  return `new_cards:${chatId}:${date}`;
}

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

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayScore(): number {
  return dateScore(todayString());
}

const DEFAULT_PROGRESS: Omit<CardProgress, "next_review_date"> = {
  ease_factor: 2.5,
  interval_days: 1,
  review_count: 0,
};

// ---- Content: shared by every user, seeded once ----

export async function getCardContent(deck: string, cardId: string): Promise<CardContent | null> {
  return redis.get<CardContent>(contentKey(deck, cardId));
}

export async function saveCardContent(deck: string, cardId: string, content: CardContent): Promise<void> {
  await redis.set(contentKey(deck, cardId), content);
  await redis.sadd(ALL_CARDS_KEY, memberId(deck, cardId));
}

export async function registerDeck(deck: string): Promise<void> {
  await redis.sadd(DECKS_KEY, deck);
}

export async function listDecks(): Promise<string[]> {
  return redis.smembers(DECKS_KEY);
}

export async function countAllCards(): Promise<number> {
  return redis.scard(ALL_CARDS_KEY);
}

/** Card count per deck — for an overview like /decks. */
export async function countCardsPerDeck(): Promise<{ deck: string; count: number }[]> {
  const members = await redis.smembers<string[]>(ALL_CARDS_KEY);
  const counts = new Map<string, number>();
  for (const m of members) {
    const { deck } = parseMemberId(m);
    counts.set(deck, (counts.get(deck) ?? 0) + 1);
  }
  return [...counts.entries()].map(([deck, count]) => ({ deck, count })).sort((a, b) => a.deck.localeCompare(b.deck));
}

/** Every card's content across every deck — the full shared catalog. */
export async function getAllCardContent(): Promise<{ deck: string; cardId: string; content: CardContent }[]> {
  const members = await redis.smembers<string[]>(ALL_CARDS_KEY);
  if (members.length === 0) return [];

  const keys = members.map((m) => {
    const { deck, cardId } = parseMemberId(m);
    return contentKey(deck, cardId);
  });
  const contents = await redis.mget<(CardContent | null)[]>(keys);

  return members
    .map((m, i) => ({ ...parseMemberId(m), content: contents[i] }))
    .filter((x): x is { deck: string; cardId: string; content: CardContent } => x.content !== null);
}

export async function getCardContentByDeck(deck: string): Promise<{ cardId: string; content: CardContent }[]> {
  const all = await getAllCardContent();
  return all.filter((x) => x.deck === deck).map(({ cardId, content }) => ({ cardId, content }));
}

/** Picks a random card's content, optionally excluding one member id (e.g. the quiz question itself). */
export async function randomCardContent(
  excludeMember?: string
): Promise<{ deck: string; cardId: string; content: CardContent } | null> {
  const candidates = await redis.srandmember<string[]>(ALL_CARDS_KEY, 5);
  for (const member of candidates ?? []) {
    if (member === excludeMember) continue;
    const { deck, cardId } = parseMemberId(member);
    const content = await getCardContent(deck, cardId);
    if (content) return { deck, cardId, content };
  }
  return null;
}

/** Finds a card's content by its Afrikaans word/phrase text, searching every known deck. */
export async function findCardByWord(
  text: string
): Promise<{ deck: string; cardId: string; content: CardContent } | null> {
  const cardId = slugify(text);
  const decks = await listDecks();
  for (const deck of decks) {
    const content = await getCardContent(deck, cardId);
    if (content) return { deck, cardId, content };
  }
  return null;
}

/** Loose substring match against word or translation — a "did you mean" fallback for a missed exact lookup. */
export async function suggestCards(
  query: string,
  limit = 3
): Promise<{ deck: string; cardId: string; content: CardContent }[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const all = await getAllCardContent();
  return all
    .filter(
      (c) =>
        c.content.afrikaans_word.toLowerCase().includes(q) ||
        c.content.english_translation.toLowerCase().includes(q)
    )
    .slice(0, limit);
}

// ---- Progress: private per user ----

async function trackUser(chatId: number): Promise<void> {
  await redis.sadd(USERS_KEY, String(chatId));
}

export async function listUsers(): Promise<number[]> {
  const ids = await redis.smembers<string[]>(USERS_KEY);
  return ids.map(Number);
}

export async function getProgress(chatId: number, deck: string, cardId: string): Promise<CardProgress | null> {
  return redis.get<CardProgress>(progressKey(chatId, deck, cardId));
}

export async function saveProgress(
  chatId: number,
  deck: string,
  cardId: string,
  progress: CardProgress
): Promise<void> {
  const member = memberId(deck, cardId);
  await redis.set(progressKey(chatId, deck, cardId), progress);
  await redis.zadd(dueIndexKey(chatId), { score: dateScore(progress.next_review_date), member });
  await redis.sadd(enrolledKey(chatId), member);
  await trackUser(chatId);
}

const DAILY_NEW_CARD_LIMIT = 20;

/**
 * Ensures a user has progress (and a due-index entry) for their next batch of unseen cards,
 * creating default SM-2 state for each one introduced. Covers both first-time enrollment and
 * picking up newly added content for existing users — same operation either way. Cheap
 * (one SDIFF) when there's nothing new, so safe to call on every /review or /progress.
 *
 * Caps how many *new* (never-before-seen) cards get introduced per calendar day, same idea as
 * Anki's daily new-card limit — a first-time user gets a first batch of 20 to review, not the
 * entire 363-card catalog dumped on them at once. Cards already in progress (due for
 * re-review) aren't affected by this cap at all, only ones never seen before.
 */
export async function ensureEnrolled(chatId: number): Promise<void> {
  const missing = (await redis.sdiff(ALL_CARDS_KEY, enrolledKey(chatId))) as string[];
  if (missing.length === 0) return;

  const today = todayString();
  const introducedKey = newCardsTodayKey(chatId, today);
  const introducedToday = (await redis.get<number>(introducedKey)) ?? 0;
  const budget = DAILY_NEW_CARD_LIMIT - introducedToday;
  if (budget <= 0) return;

  // Deterministic order (alphabetical by deck, then card) rather than the arbitrary set-diff
  // order, so a new user's first batch is a stable, reasonable slice, not shuffled every call.
  const toIntroduce = missing.sort().slice(0, budget);
  for (const member of toIntroduce) {
    const { deck, cardId } = parseMemberId(member);
    await saveProgress(chatId, deck, cardId, { ...DEFAULT_PROGRESS, next_review_date: today });
  }

  if (toIntroduce.length > 0) {
    // TTL well past a day is just cheap self-cleanup; the date-scoped key is what actually resets it.
    await redis.set(introducedKey, introducedToday + toIntroduce.length, { ex: 60 * 60 * 24 * 2 });
  }
}

/** Returns one due (or overdue) card's member id for this user, or null if nothing is due. */
export async function nextDueMember(chatId: number): Promise<string | null> {
  await ensureEnrolled(chatId);
  const results = await redis.zrange<string[]>(dueIndexKey(chatId), 0, todayScore(), {
    byScore: true,
    offset: 0,
    count: 1,
  });
  return results[0] ?? null;
}

export async function countDue(chatId: number): Promise<number> {
  await ensureEnrolled(chatId);
  return redis.zcount(dueIndexKey(chatId), "-inf", todayScore());
}

export async function logReview(chatId: number, member: string, rating: ReviewLogEntry["rating"]): Promise<void> {
  const entry: ReviewLogEntry = { card_id: member, rating };
  await redis.set(`review_log:${chatId}:${Date.now()}`, entry);
  await redis.sadd(reviewDatesKey(chatId), todayString());
}

const MASTERED_INTERVAL_DAYS = 21;

/** Every card this user is enrolled in, content + their own progress — for /progress and mastery. */
export async function getAllProgressForUser(
  chatId: number
): Promise<{ deck: string; cardId: string; content: CardContent; progress: CardProgress }[]> {
  await ensureEnrolled(chatId);
  const members = await redis.smembers<string[]>(enrolledKey(chatId));
  if (members.length === 0) return [];

  const progressKeys = members.map((m) => {
    const { deck, cardId } = parseMemberId(m);
    return progressKey(chatId, deck, cardId);
  });
  const contentKeys = members.map((m) => {
    const { deck, cardId } = parseMemberId(m);
    return contentKey(deck, cardId);
  });

  const [progresses, contents] = await Promise.all([
    redis.mget<(CardProgress | null)[]>(progressKeys),
    redis.mget<(CardContent | null)[]>(contentKeys),
  ]);

  return members
    .map((m, i) => ({ ...parseMemberId(m), content: contents[i], progress: progresses[i] }))
    .filter(
      (x): x is { deck: string; cardId: string; content: CardContent; progress: CardProgress } =>
        x.content !== null && x.progress !== null
    );
}

export async function countMastered(chatId: number): Promise<number> {
  const all = await getAllProgressForUser(chatId);
  return all.filter((x) => x.progress.interval_days >= MASTERED_INTERVAL_DAYS).length;
}

/** Consecutive days (ending today or yesterday) with at least one logged review, for this user. */
export async function getReviewStreak(chatId: number): Promise<number> {
  const dates = await redis.smembers<string[]>(reviewDatesKey(chatId));
  const dateSet = new Set(dates);

  const cursor = new Date();
  if (!dateSet.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (dateSet.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
