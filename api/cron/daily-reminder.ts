import type { VercelRequest, VercelResponse } from "@vercel/node";
import { countDue, listUsers } from "../../lib/cards.js";
import { formatWordOfDay, getWordOfDay } from "../../lib/word-of-day.js";
import { bot } from "../../lib/bot.js";
import { redis } from "../../lib/redis.js";

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send("Unauthorized");
    return;
  }

  const today = todayString();
  const word = await getWordOfDay().catch((err) => {
    console.error("Word of the day generation failed:", err);
    return null;
  });

  const users = await listUsers();
  let notified = 0;

  for (const chatId of users) {
    // Atomic SET NX guard: only the first invocation for this user today actually sends,
    // regardless of how many times (or how close together) the cron itself fires.
    const guardKey = `reminder_sent:${chatId}:${today}`;
    const acquired = await redis.set(guardKey, "1", { nx: true, ex: 60 * 60 * 24 * 2 });
    if (!acquired) continue;

    const due = await countDue(chatId);
    const lines: string[] = [];
    if (word) lines.push(formatWordOfDay(word));
    if (due > 0) {
      if (lines.length > 0) lines.push("");
      lines.push(`📚 ${due} card${due === 1 ? "" : "s"} due for review. Send /review to start.`);
    }
    if (lines.length === 0) continue;

    try {
      await bot.api.sendMessage(chatId, lines.join("\n"));
      notified++;
    } catch (err) {
      // e.g. the user blocked the bot; don't let one failure stop reminders to everyone else.
      console.error(`Failed to notify chat ${chatId}:`, err);
    }
  }

  res.status(200).json({ users: users.length, notified, word: word?.content.afrikaans_word ?? null });
}
