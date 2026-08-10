import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN environment variables are not set");
}

export const redis = new Redis({ url, token });

export function cardKey(deck: string, cardId: string): string {
  return `card:${deck}:${cardId}`;
}
