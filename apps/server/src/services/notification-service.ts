export type NotificationChannelConfig = {
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  discordWebhookUrl?: string | null;
  discordNickname?: string | null;
};

export type IntegrationStatus = {
  telegramConfigured: boolean;
  discordConfigured: boolean;
};

export type NotificationDeliveryReport = {
  telegram: "sent" | "skipped" | "failed";
  discord: "sent" | "skipped" | "failed";
  errors: string[];
};

function normalize(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getChannelConfigFromEnv(): NotificationChannelConfig {
  return {
    telegramBotToken: normalize(process.env.TELEGRAM_BOT_TOKEN),
    telegramChatId: normalize(process.env.TELEGRAM_CHAT_ID),
    discordWebhookUrl: normalize(process.env.DISCORD_WEBHOOK_URL),
    discordNickname: null,
  };
}

function getEffectiveConfig(override?: NotificationChannelConfig): NotificationChannelConfig {
  const base = getChannelConfigFromEnv();
  return {
    telegramBotToken: normalize(override?.telegramBotToken) ?? base.telegramBotToken ?? null,
    telegramChatId: normalize(override?.telegramChatId) ?? base.telegramChatId ?? null,
    discordWebhookUrl: normalize(override?.discordWebhookUrl) ?? base.discordWebhookUrl ?? null,
    discordNickname: normalize(override?.discordNickname) ?? null,
  };
}

function buildDiscordMessage(message: string, nickname?: string | null): string {
  const nick = normalize(nickname);
  if (!nick) {
    return message;
  }
  if (nick.startsWith("<@") || nick.startsWith("@")) {
    return `${nick} ${message}`;
  }
  return `@${nick} ${message}`;
}

async function notifyTelegram(message: string, config: NotificationChannelConfig): Promise<void> {
  const token = normalize(config.telegramBotToken);
  const chatId = normalize(config.telegramChatId);
  if (!token || !chatId) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 403 && body.includes("bots can't send messages to bots")) {
      throw new Error(
        "Telegram error 403: бот не может писать другому боту. " +
          "Укажите chat_id обычного чата/группы/канала, где бот добавлен и имеет право отправки.",
      );
    }
    throw new Error(`Telegram error: ${response.status} ${body}`);
  }
}

async function notifyDiscord(message: string, config: NotificationChannelConfig): Promise<void> {
  const webhookUrl = normalize(config.discordWebhookUrl);
  if (!webhookUrl) {
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: buildDiscordMessage(message, config.discordNickname),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord error: ${response.status} ${body}`);
  }
}

export function getIntegrationStatus(config?: NotificationChannelConfig): IntegrationStatus {
  const effective = getEffectiveConfig(config);
  return {
    telegramConfigured: Boolean(effective.telegramBotToken && effective.telegramChatId),
    discordConfigured: Boolean(effective.discordWebhookUrl),
  };
}

export function channelsConfigured(config?: NotificationChannelConfig): boolean {
  const status = getIntegrationStatus(config);
  return status.telegramConfigured || status.discordConfigured;
}

export async function notifyChannelsDetailed(
  message: string,
  config?: NotificationChannelConfig,
): Promise<NotificationDeliveryReport> {
  const effective = getEffectiveConfig(config);
  const status = getIntegrationStatus(effective);
  const errors: string[] = [];
  const result: NotificationDeliveryReport = {
    telegram: status.telegramConfigured ? "sent" : "skipped",
    discord: status.discordConfigured ? "sent" : "skipped",
    errors,
  };

  if (status.telegramConfigured) {
    try {
      await notifyTelegram(message, effective);
    } catch (error) {
      result.telegram = "failed";
      errors.push(error instanceof Error ? error.message : "Telegram send failed");
    }
  }

  if (status.discordConfigured) {
    try {
      await notifyDiscord(message, effective);
    } catch (error) {
      result.discord = "failed";
      errors.push(error instanceof Error ? error.message : "Discord send failed");
    }
  }

  return result;
}

export async function notifyChannels(message: string, config?: NotificationChannelConfig): Promise<void> {
  const report = await notifyChannelsDetailed(message, config);
  if (report.errors.length > 0) {
    for (const error of report.errors) {
      console.error("Notification send failed:", error);
    }
  }
}
