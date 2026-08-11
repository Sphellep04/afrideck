import { redis } from "./redis.js";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const HISTORY_KEY_PREFIX = "chat_history:";
const MAX_HISTORY_MESSAGES = 12;
const HISTORY_TTL_SECONDS = 60 * 60 * 24;

const SYSTEM_PROMPT =
  "You are the conversational side of AfriDeck, a Telegram bot that teaches Afrikaans " +
  "vocabulary through spaced repetition. Be a warm, encouraging Afrikaans language helper: " +
  "answer questions about Afrikaans grammar, vocabulary, or culture, and happily do short " +
  "conversation practice in Afrikaans if asked. Keep replies concise, a few sentences, " +
  "chat-app length, not an essay. Do not use em dashes; use commas, periods, or parentheses " +
  "instead. If relevant, mention the bot's other commands: /review (daily spaced-repetition " +
  "review), /quiz (multiple choice), /progress (stats), and /pronounce or /recordings " +
  "(audio, once configured).";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Generates a reply via Groq, keeping short-lived per-chat conversation history in Redis. */
export async function chatReply(chatId: number, userMessage: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set");
  }

  const historyKey = `${HISTORY_KEY_PREFIX}${chatId}`;
  const history = (await redis.get<ChatMessage[]>(historyKey)) ?? [];

  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userMessage },
      ],
      temperature: 0.6,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq chat request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("No content in Groq chat response");
  }

  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: reply },
  ].slice(-MAX_HISTORY_MESSAGES);
  await redis.set(historyKey, updatedHistory, { ex: HISTORY_TTL_SECONDS });

  return reply;
}
