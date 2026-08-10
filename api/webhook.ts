import type { VercelRequest, VercelResponse } from "@vercel/node";
import { webhookCallback } from "grammy";
import { bot } from "../lib/bot.js";

const handleUpdate = webhookCallback(bot, "http", {
  secretToken: process.env.WEBHOOK_SECRET,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  await handleUpdate(req, res);
}
