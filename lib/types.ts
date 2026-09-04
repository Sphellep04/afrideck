/** Card content — shared by every user (word, translation, examples, cached reference audio). */
export interface CardContent {
  afrikaans_word: string;
  english_translation: string;
  example_sentence_af: string;
  example_sentence_en: string;
  audio_url: string;
}

/** SM-2 scheduling state — private to one user. */
export interface CardProgress {
  ease_factor: number;
  interval_days: number;
  next_review_date: string;
  review_count: number;
}

export interface ReviewLogEntry {
  card_id: string;
  rating: "again" | "hard" | "good" | "easy";
}
