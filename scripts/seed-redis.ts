import { readFileSync } from "node:fs";
import { saveCardContent, registerDeck } from "../lib/cards.js";
import { slugify } from "../lib/slug.js";
import type { CardContent } from "../lib/types.js";

interface SeedCard {
  deck: string;
  afrikaans_word: string;
  english_translation: string;
  example_sentence_af: string;
  example_sentence_en: string;
}

async function main() {
  const cards: SeedCard[] = JSON.parse(
    readFileSync(new URL("../data/seed-cards.json", import.meta.url), "utf-8")
  );

  let seeded = 0;

  for (const c of cards) {
    const cardId = slugify(c.afrikaans_word);
    const content: CardContent = {
      afrikaans_word: c.afrikaans_word,
      english_translation: c.english_translation,
      example_sentence_af: c.example_sentence_af,
      example_sentence_en: c.example_sentence_en,
      audio_url: "",
    };

    await saveCardContent(c.deck, cardId, content);
    await registerDeck(c.deck);
    seeded++;
  }

  console.log(`Seeded ${seeded} cards' content into Redis. Each user's SM-2 progress is created on first use.`);
}

main();
