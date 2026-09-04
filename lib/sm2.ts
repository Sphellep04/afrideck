import type { CardProgress, ReviewLogEntry } from "./types.js";

export type Rating = ReviewLogEntry["rating"];

const MIN_EASE_FACTOR = 1.3;

export function applySM2(progress: CardProgress, rating: Rating): CardProgress {
  let easeFactor = progress.ease_factor;
  let intervalDays = progress.interval_days;

  switch (rating) {
    case "again":
      intervalDays = 1;
      easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2);
      break;
    case "hard":
      intervalDays = Math.max(1, Math.round(intervalDays * 1.2));
      easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.15);
      break;
    case "good":
      intervalDays = Math.max(1, Math.round(intervalDays * easeFactor));
      break;
    case "easy":
      intervalDays = Math.max(1, Math.round(intervalDays * easeFactor * 1.3));
      easeFactor = easeFactor + 0.15;
      break;
  }

  const next = new Date();
  next.setUTCDate(next.getUTCDate() + intervalDays);

  return {
    ease_factor: Math.round(easeFactor * 100) / 100,
    interval_days: intervalDays,
    next_review_date: next.toISOString().slice(0, 10),
    review_count: progress.review_count + 1,
  };
}
