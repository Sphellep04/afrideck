const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const url = process.env.WEBHOOK_URL;

if (!token || !secret || !url) {
  console.error("Set BOT_TOKEN, WEBHOOK_SECRET and WEBHOOK_URL before running this script.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret }),
});

console.log(await res.json());

export {};
