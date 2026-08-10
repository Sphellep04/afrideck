import { readFileSync } from "node:fs";
import { redis, cardKey } from "../lib/redis.js";
import type { Card } from "../lib/types.js";

interface SeedCard {
  deck: string;
  afrikaans_word: string;
  english_translation: string;
  example_sentence_af: string;
  example_sentence_en: string;
}

function slugify(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const cards: SeedCard[] = JSON.parse(
    readFileSync(new URL("../data/seed-cards.json", import.meta.url), "utf-8")
  );

  const today = new Date().toISOString().slice(0, 10);
  let seeded = 0;

  for (const c of cards) {
    const cardId = slugify(c.afrikaans_word);
    const card: Card = {
      afrikaans_word: c.afrikaans_word,
      english_translation: c.english_translation,
      example_sentence_af: c.example_sentence_af,
      example_sentence_en: c.example_sentence_en,
      audio_url: "",
      ease_factor: 2.5,
      interval_days: 1,
      next_review_date: today,
      review_count: 0,
    };

    await redis.set(cardKey(c.deck, cardId), card);
    await redis.zadd("due_index", { score: Date.parse(today), member: `${c.deck}:${cardId}` });
    seeded++;
  }

  console.log(`Seeded ${seeded} cards into Redis, all due today (${today}).`);
}

main();
