import { readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error("Set GROQ_API_KEY before running this script.");
  process.exit(1);
}

interface SeedWord {
  deck: string;
  afrikaans_word: string;
  english_translation: string;
  wiktionary_match: boolean;
  wiktionary_gloss: string | null;
}

interface SentenceResult {
  example_sentence_af: string;
  example_sentence_en: string;
  confirmed_translation: string;
}

interface SeedCard extends SeedWord {
  example_sentence_af: string;
  example_sentence_en: string;
}

const MODEL = "openai/gpt-oss-120b";

async function generateSentence(word: SeedWord): Promise<SentenceResult> {
  const prompt = `You are an Afrikaans language tutor. For the Afrikaans word or phrase "${word.afrikaans_word}" (draft English translation: "${word.english_translation}"), respond with strict JSON only, no markdown fences, in this exact shape:
{"example_sentence_af": "a short, natural Afrikaans sentence using the word or phrase", "example_sentence_en": "the English translation of that example sentence", "confirmed_translation": "the correct, corrected English translation of the word or phrase itself"}
Do not use em dashes or en dashes; use commas or periods instead.`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq request failed for "${word.afrikaans_word}": ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No content in Groq response for "${word.afrikaans_word}"`);

  return JSON.parse(content);
}

async function main() {
  const seedWords: SeedWord[] = JSON.parse(
    readFileSync(new URL("../data/seed-words.json", import.meta.url), "utf-8")
  );

  const cards: SeedCard[] = [];
  let i = 0;

  for (const word of seedWords) {
    i++;
    process.stdout.write(`[${i}/${seedWords.length}] ${word.afrikaans_word} ... `);
    try {
      const result = await generateSentence(word);
      cards.push({
        ...word,
        english_translation: result.confirmed_translation || word.english_translation,
        example_sentence_af: result.example_sentence_af,
        example_sentence_en: result.example_sentence_en,
      });
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      // Fall back to the curated translation with no example sentence rather than dropping the card.
      cards.push({
        ...word,
        example_sentence_af: "",
        example_sentence_en: "",
      });
    }
    // Conservative pacing to stay well under Groq's rate limits.
    await new Promise((r) => setTimeout(r, 2100));
  }

  writeFileSync(new URL("../data/seed-cards.json", import.meta.url), JSON.stringify(cards, null, 2));
  console.log(`Wrote data/seed-cards.json with ${cards.length} cards`);
}

main();
