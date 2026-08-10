import { redis } from "./redis.js";
import { memberId, randomCard } from "./cards.js";

interface QuizSession {
  afrikaans_word: string;
  choices: string[];
  correctIndex: number;
}

const QUIZ_TTL_SECONDS = 300;

function quizKey(chatId: number): string {
  return `quiz:${chatId}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface QuizQuestion {
  afrikaans_word: string;
  choices: string[];
}

/** Starts a new multiple-choice quiz question for a chat, independent of SRS scheduling. */
export async function startQuiz(chatId: number): Promise<QuizQuestion | null> {
  const question = await randomCard();
  if (!question) return null;

  const distractors: string[] = [];
  const seen = new Set([question.card.english_translation]);
  const excluded = memberId(question.deck, question.cardId);

  for (let attempts = 0; attempts < 5 && distractors.length < 3; attempts++) {
    const candidate = await randomCard(excluded);
    if (candidate && !seen.has(candidate.card.english_translation)) {
      seen.add(candidate.card.english_translation);
      distractors.push(candidate.card.english_translation);
    }
  }

  const choices = shuffle([question.card.english_translation, ...distractors]);
  const correctIndex = choices.indexOf(question.card.english_translation);

  const session: QuizSession = { afrikaans_word: question.card.afrikaans_word, choices, correctIndex };
  await redis.set(quizKey(chatId), session, { ex: QUIZ_TTL_SECONDS });

  return { afrikaans_word: session.afrikaans_word, choices: session.choices };
}

export interface QuizResult {
  correct: boolean;
  afrikaans_word: string;
  correctAnswer: string;
}

/** Scores an answer against the chat's pending question and clears the session. */
export async function answerQuiz(chatId: number, chosenIndex: number): Promise<QuizResult | null> {
  const session = await redis.get<QuizSession>(quizKey(chatId));
  if (!session) return null;

  await redis.del(quizKey(chatId));

  return {
    correct: chosenIndex === session.correctIndex,
    afrikaans_word: session.afrikaans_word,
    correctAnswer: session.choices[session.correctIndex],
  };
}
