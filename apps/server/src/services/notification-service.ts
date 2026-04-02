const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function notifyTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram error: ${response.status} ${body}`);
  }
}

async function notifyDiscord(message: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord error: ${response.status} ${body}`);
  }
}

export async function notifyChannels(message: string): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  tasks.push(notifyTelegram(message));
  tasks.push(notifyDiscord(message));

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Notification send failed:", result.reason);
    }
  }
}

export function channelsConfigured(): boolean {
  return Boolean((TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) || DISCORD_WEBHOOK_URL);
}
