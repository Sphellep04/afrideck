/**
 * Pre-generates and caches the Word of the Day explanation for every vocab card (not grammar),
 * rather than letting it lazy-generate live as each day's word comes up. Word of the Day content
 * is cached forever and recurs on a ~363-day rotation, so it gets the same "generate, then
 * actually review before it's live" treatment as the rest of this project's content.
 */
import { getAllCardContent } from "../lib/cards.js";
import { getWordExplanation } from "../lib/word-of-day.js";
import { GRAMMAR_DECK } from "../lib/grammar.js";

async function main() {
  const all = (await getAllCardContent()).filter((c) => c.deck !== GRAMMAR_DECK);
  console.log(`Generating explanations for ${all.length} words...`);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < all.length; i++) {
    const { deck, cardId, content } = all[i];
    process.stdout.write(`[${i + 1}/${all.length}] ${content.afrikaans_word} ... `);
    try {
      await getWordExplanation(deck, cardId, content);
      console.log("ok");
      ok++;
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      failed++;
    }
    // These completions run ~1300-1500 tokens each against an 8000 tokens/minute cap, so the
    // request-count pacing used elsewhere isn't enough here - need ~11s between calls to stay
    // under the token budget, not just a couple seconds between requests.
    await new Promise((r) => setTimeout(r, 11000));
  }

  console.log(`Done: ${ok} generated, ${failed} failed.`);
}

main();
