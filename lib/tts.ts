const ENDPOINT = "https://translate.google.com/translate_tts";

/**
 * Unofficial, keyless endpoint — no formal API or uptime guarantee. If it starts failing
 * consistently, the documented fallback is espeak-ng, self-hosted (see project plan, phase 4 risks).
 */
export async function synthesize(text: string): Promise<Uint8Array> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("q", text);
  url.searchParams.set("tl", "af");
  url.searchParams.set("client", "tw-ob");

  const res = await fetch(url.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      referer: "https://translate.google.com/",
    },
  });

  if (!res.ok) {
    throw new Error(`Google Translate TTS request failed for "${text}": ${res.status}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}
