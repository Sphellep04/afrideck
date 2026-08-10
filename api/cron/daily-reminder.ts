import type { VercelRequest, VercelResponse } from "@vercel/node";
import { countDue } from "../../lib/cards.js";
import { bot } from "../../lib/bot.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send("Unauthorized");
    return;
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    res.status(500).send("TELEGRAM_CHAT_ID environment variable is not set");
    return;
  }

  const due = await countDue();
  if (due > 0) {
    await bot.api.sendMessage(
      chatId,
      `📚 ${due} card${due === 1 ? "" : "s"} due for review today. Send /review to start.`
    );
  }

  res.status(200).json({ due });
}
