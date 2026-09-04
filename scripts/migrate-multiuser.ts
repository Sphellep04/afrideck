/**
 * One-off migration: splits the old global card:{deck}:{cardId} records (content + SM-2 state
 * merged together) into shared content (card_content:{deck}:{cardId}) and per-user progress
 * (progress:{chatId}:{deck}:{cardId}), preserving the existing owner's earned progress rather
 * than resetting it. Also migrates review_dates (streak) and review_log entries to that user,
 * then cleans up the superseded global keys.
 *
 * Safe to run only once, before the multi-user bot code is deployed. Run with:
 *   npx tsx --env-file=.env scripts/migrate-multiuser.ts
 */
import { redis } from "../lib/redis.js";
import { saveCardContent, saveProgress, parseMemberId } from "../lib/cards.js";
import type { CardContent, CardProgress } from "../lib/types.js";

// The one chat that's used the bot so far (confirmed via chat_history: keys before this refactor).
const EXISTING_USER_CHAT_ID = 1012684481;

interface OldCard extends CardContent, CardProgress {}

async function main() {
  const members = await redis.smembers<string[]>("all_cards");
  console.log(`Found ${members.length} cards to migrate.`);

  let migrated = 0;
  for (const member of members) {
    const { deck, cardId } = parseMemberId(member);
    const old = await redis.get<OldCard>(`card:${deck}:${cardId}`);
    if (!old) {
      console.log(`  skip ${member}: no old record found`);
      continue;
    }

    const content: CardContent = {
      afrikaans_word: old.afrikaans_word,
      english_translation: old.english_translation,
      example_sentence_af: old.example_sentence_af,
      example_sentence_en: old.example_sentence_en,
      audio_url: old.audio_url,
    };
    const progress: CardProgress = {
      ease_factor: old.ease_factor,
      interval_days: old.interval_days,
      next_review_date: old.next_review_date,
      review_count: old.review_count,
    };

    await saveCardContent(deck, cardId, content);
    await saveProgress(EXISTING_USER_CHAT_ID, deck, cardId, progress);
    migrated++;
  }
  console.log(`Migrated content + progress for ${migrated} cards.`);

  const reviewDates = await redis.smembers<string[]>("review_dates");
  for (const date of reviewDates) {
    await redis.sadd(`review_dates:${EXISTING_USER_CHAT_ID}`, date);
  }
  if (reviewDates.length > 0) {
    console.log(`Migrated ${reviewDates.length} review dates (streak history).`);
  }

  const oldLogKeys = await redis.keys("review_log:*");
  let logsMigrated = 0;
  for (const key of oldLogKeys) {
    // Old format: review_log:{timestamp}. Skip anything already in the new format
    // (review_log:{chatId}:{timestamp}) in case this script is re-run.
    const rest = key.slice("review_log:".length);
    if (rest.includes(":")) continue;

    const entry = await redis.get(key);
    if (!entry) continue;
    await redis.set(`review_log:${EXISTING_USER_CHAT_ID}:${rest}`, entry);
    await redis.del(key);
    logsMigrated++;
  }
  console.log(`Migrated ${logsMigrated} review log entries.`);

  // Clean up superseded global keys.
  const oldCardKeys = members.map((m) => {
    const { deck, cardId } = parseMemberId(m);
    return `card:${deck}:${cardId}`;
  });
  if (oldCardKeys.length > 0) await redis.del(...oldCardKeys);
  await redis.del("due_index", "review_dates");

  console.log("Cleaned up old global card/due_index/review_dates keys.");
  console.log("Migration complete.");
}

main();
