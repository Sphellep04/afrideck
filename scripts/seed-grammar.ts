import { readFileSync } from "node:fs";
import { saveCardContent, registerDeck } from "../lib/cards.js";
import { saveGrammarLesson, GRAMMAR_DECK } from "../lib/grammar.js";
import { slugify } from "../lib/slug.js";
import type { CardContent } from "../lib/types.js";

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

  let seeded = 0;

  for (const lesson of lessons) {
    const cardId = slugify(lesson.title_af);
    const firstExample = lesson.examples[0];

    const content: CardContent = {
      afrikaans_word: lesson.title_af,
      english_translation: lesson.title_en,
      example_sentence_af: firstExample?.af ?? "",
      example_sentence_en: firstExample?.en ?? "",
      audio_url: "",
    };

    await saveCardContent(GRAMMAR_DECK, cardId, content);
    await registerDeck(GRAMMAR_DECK);
    await saveGrammarLesson(cardId, { explanation: lesson.explanation, examples: lesson.examples });
    seeded++;
  }

  console.log(`Seeded ${seeded} grammar topics' content into Redis. Each user's SM-2 progress is created on first use.`);
}

main();
