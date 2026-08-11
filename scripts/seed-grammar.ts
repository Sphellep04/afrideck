import { readFileSync } from "node:fs";
import { saveCard, registerDeck } from "../lib/cards.js";
import { saveGrammarLesson, GRAMMAR_DECK } from "../lib/grammar.js";
import { slugify } from "../lib/slug.js";
import type { Card } from "../lib/types.js";

interface GrammarExample {
  af: string;
  en: string;
}

interface GrammarLessonRecord {
  title_af: string;
  title_en: string;
  explanation: string;
  examples: GrammarExample[];
}

async function main() {
  const lessons: GrammarLessonRecord[] = JSON.parse(
    readFileSync(new URL("../data/grammar-lessons.json", import.meta.url), "utf-8")
  );

  const today = new Date().toISOString().slice(0, 10);
  let seeded = 0;

  for (const lesson of lessons) {
    const cardId = slugify(lesson.title_af);
    const firstExample = lesson.examples[0];

    const card: Card = {
      afrikaans_word: lesson.title_af,
      english_translation: lesson.title_en,
      example_sentence_af: firstExample?.af ?? "",
      example_sentence_en: firstExample?.en ?? "",
      audio_url: "",
      ease_factor: 2.5,
      interval_days: 1,
      next_review_date: today,
      review_count: 0,
    };

    await saveCard(GRAMMAR_DECK, cardId, card);
    await registerDeck(GRAMMAR_DECK);
    await saveGrammarLesson(cardId, { explanation: lesson.explanation, examples: lesson.examples });
    seeded++;
  }

  console.log(`Seeded ${seeded} grammar topics into Redis, all due today (${today}).`);
}

main();
