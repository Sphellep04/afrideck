import { getCardContent, saveCardContent } from "./cards.js";
import { getObject, putObject, listObjects, type R2ListedObject } from "./r2.js";
import { synthesize } from "./tts.js";
import type { CardContent } from "./types.js";

function referenceKey(deck: string, cardId: string): string {
  return `reference/${deck}/${cardId}.mp3`;
}

function recordingKey(chatId: number, deck: string, cardId: string, timestamp: number): string {
  return `recordings/${chatId}/${deck}/${cardId}/${timestamp}.ogg`;
}

/**
 * Returns the reference pronunciation audio, generating and caching it in R2 on first use.
 * Shared across every user — there's no reason to regenerate the same TTS clip per person.
 */
export async function getReferenceAudio(deck: string, cardId: string, content: CardContent): Promise<Uint8Array> {
  if (content.audio_url) {
    const cached = await getObject(content.audio_url);
    if (cached) return cached;
  }

  const audio = await synthesize(content.afrikaans_word);
  const key = referenceKey(deck, cardId);
  await putObject(key, audio, "audio/mpeg");

  const fresh = (await getCardContent(deck, cardId)) ?? content;
  await saveCardContent(deck, cardId, { ...fresh, audio_url: key });

  return audio;
}

/** Practice recordings are private per user. */
export async function storeRecording(
  chatId: number,
  deck: string,
  cardId: string,
  audio: Uint8Array
): Promise<string> {
  const key = recordingKey(chatId, deck, cardId, Date.now());
  await putObject(key, audio, "audio/ogg");
  return key;
}

export async function listRecordings(chatId: number, deck: string, cardId: string): Promise<R2ListedObject[]> {
  const objects = await listObjects(`recordings/${chatId}/${deck}/${cardId}/`);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}
