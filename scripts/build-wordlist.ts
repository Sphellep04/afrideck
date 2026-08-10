import { readFileSync, writeFileSync } from "node:fs";

interface CuratedWord {
  deck: string;
  afrikaans_word: string;
  english_translation: string;
}

interface WiktionarySense {
  glosses?: string[];
}

interface WiktionaryEntry {
  word: string;
  pos: string;
  senses?: WiktionarySense[];
}

interface SeedWord extends CuratedWord {
  wiktionary_match: boolean;
  wiktionary_gloss: string | null;
}

const curated: CuratedWord[] = JSON.parse(
  readFileSync(new URL("../data/curated-words.json", import.meta.url), "utf-8")
);

const raw = readFileSync(new URL("../data/wiktionary-afrikaans-raw.jsonl", import.meta.url), "utf-8");
const byWord = new Map<string, WiktionaryEntry[]>();

for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  const entry: WiktionaryEntry = JSON.parse(line);
  const key = entry.word.toLowerCase();
  const list = byWord.get(key) ?? [];
  list.push(entry);
  byWord.set(key, list);
}

const seedWords: SeedWord[] = [];
let matched = 0;
let unmatched = 0;

for (const word of curated) {
  // Multi-word phrases won't exist as Wiktionary headwords; only single tokens are looked up.
  const lookupKey = word.afrikaans_word.toLowerCase().replace(/[?.]/g, "").trim();
  const entries = byWord.get(lookupKey);
  const firstGloss = entries?.[0]?.senses?.find((s) => s.glosses?.length)?.glosses?.[0] ?? null;

  if (firstGloss) matched++;
  else unmatched++;

  seedWords.push({
    ...word,
    wiktionary_match: Boolean(firstGloss),
    wiktionary_gloss: firstGloss,
  });
}

writeFileSync(
  new URL("../data/seed-words.json", import.meta.url),
  JSON.stringify(seedWords, null, 2)
);

const byDeck = new Map<string, number>();
for (const w of curated) byDeck.set(w.deck, (byDeck.get(w.deck) ?? 0) + 1);

console.log(`Total words: ${curated.length}`);
for (const [deck, count] of byDeck) console.log(`  ${deck}: ${count}`);
console.log(`Matched against Wiktionary export: ${matched}`);
console.log(`Not found (phrases or missing headwords, translations are hand-curated): ${unmatched}`);
console.log("Wrote data/seed-words.json");
