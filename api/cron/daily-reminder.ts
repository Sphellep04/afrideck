import type { VercelRequest, VercelResponse } from "@vercel/node";
import { countDue, listUsers } from "../../lib/cards.js";
import { bot } from "../../lib/bot.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send("Unauthorized");
    return;
  }

  const users = await listUsers();
  let notified = 0;

  for (const chatId of users) {
    const due = await countDue(chatId);
    if (due === 0) continue;

    try {
      await bot.api.sendMessage(
        chatId,
        `📚 ${due} card${due === 1 ? "" : "s"} due for review today. Send /review to start.`
      );
      notified++;
    } catch (err) {
      // e.g. the user blocked the bot; don't let one failure stop reminders to everyone else.
      console.error(`Failed to notify chat ${chatId}:`, err);
    }
  }

  res.status(200).json({ users: users.length, notified });
}
