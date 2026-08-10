import { getCard, saveCard } from "./cards.js";
import { getObject, putObject, listObjects, type R2ListedObject } from "./r2.js";
import { synthesize } from "./tts.js";
import type { Card } from "./types.js";

function referenceKey(deck: string, cardId: string): string {
  return `reference/${deck}/${cardId}.mp3`;
}

function recordingKey(deck: string, cardId: string, timestamp: number): string {
  return `recordings/${deck}/${cardId}/${timestamp}.ogg`;
}

/** Returns the reference pronunciation audio, generating and caching it in R2 on first use. */
export async function getReferenceAudio(deck: string, cardId: string, card: Card): Promise<Uint8Array> {
  if (card.audio_url) {
    const cached = await getObject(card.audio_url);
    if (cached) return cached;
  }

  const audio = await synthesize(card.afrikaans_word);
  const key = referenceKey(deck, cardId);
  await putObject(key, audio, "audio/mpeg");

  const fresh = (await getCard(deck, cardId)) ?? card;
  await saveCard(deck, cardId, { ...fresh, audio_url: key });

  return audio;
}

export async function storeRecording(deck: string, cardId: string, audio: Uint8Array): Promise<string> {
  const key = recordingKey(deck, cardId, Date.now());
  await putObject(key, audio, "audio/ogg");
  return key;
}

export async function listRecordings(deck: string, cardId: string): Promise<R2ListedObject[]> {
  const objects = await listObjects(`recordings/${deck}/${cardId}/`);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}
