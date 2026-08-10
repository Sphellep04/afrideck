export interface Card {
  afrikaans_word: string;
  english_translation: string;
  example_sentence_af: string;
  example_sentence_en: string;
  audio_url: string;
  ease_factor: number;
  interval_days: number;
  next_review_date: string;
  review_count: number;
}

export interface ReviewLogEntry {
  card_id: string;
  rating: "again" | "hard" | "good" | "easy";
}
