import { readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error("Set GROQ_API_KEY before running this script.");
  process.exit(1);
}

interface GrammarTopic {
  title_af: string;
  title_en: string;
}

interface GrammarExample {
  af: string;
  en: string;
}

interface LessonContent {
  explanation: string;
  examples: GrammarExample[];
}

interface GrammarLessonRecord extends GrammarTopic {
  explanation: string;
  examples: GrammarExample[];
}

const MODEL = "openai/gpt-oss-120b";

async function generateLesson(topic: GrammarTopic): Promise<LessonContent> {
  const prompt = `You are an Afrikaans grammar teacher writing for an English-speaking beginner. For the grammar topic "${topic.title_af}" (${topic.title_en}), respond with strict JSON only, no markdown fences, in this exact shape:
{"explanation": "a clear, concise English explanation of the rule, 2-4 sentences, beginner-friendly", "examples": [{"af": "an Afrikaans example sentence", "en": "its English translation"}, {"af": "...", "en": "..."}, {"af": "...", "en": "..."}]}
Provide exactly 3 examples that clearly illustrate the rule. Do not use em dashes; use commas or periods instead.`;

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
    throw new Error(`Groq request failed for "${topic.title_af}": ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No content in Groq response for "${topic.title_af}"`);

  return JSON.parse(content);
}

async function main() {
  const topics: GrammarTopic[] = JSON.parse(
    readFileSync(new URL("../data/grammar-topics.json", import.meta.url), "utf-8")
  );

  const lessons: GrammarLessonRecord[] = [];
  let i = 0;

  for (const topic of topics) {
    i++;
    process.stdout.write(`[${i}/${topics.length}] ${topic.title_af} ... `);
    try {
      const result = await generateLesson(topic);
      lessons.push({ ...topic, explanation: result.explanation, examples: result.examples });
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(err);
      lessons.push({ ...topic, explanation: "", examples: [] });
    }
    // Conservative pacing to stay well under Groq's rate limits.
    await new Promise((r) => setTimeout(r, 2100));
  }

  writeFileSync(new URL("../data/grammar-lessons.json", import.meta.url), JSON.stringify(lessons, null, 2));
  console.log(`Wrote data/grammar-lessons.json with ${lessons.length} lessons`);
}

main();
