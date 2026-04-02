import type { AiSource, AiStatusLevel, AiSuggestion, MockReviewContext } from "@collabcode/shared";

import { createId } from "../lib/id.js";
import { reviewCodeDiff } from "./mock-ai-reviewer.js";

const MODEL = "arcee-ai/trinity-large-preview:free";

export interface AiReviewResult {
  suggestions: AiSuggestion[];
  status: AiStatusLevel;
  source: AiSource;
  message: string;
}

export interface AiNavigatorContext {
  roomId: string;
  goal: string;
  code: string;
  recentEvents: string[];
  recentSuggestions: string[];
  question: string;
}

export interface AiNavigatorResult {
  answer: string;
  source: AiSource;
}

export interface AiProviderStatus {
  enabled: boolean;
  provider: "openrouter";
  model: string;
}

function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? key : null;
}

export function getAiProviderStatus(): AiProviderStatus {
  return {
    enabled: Boolean(getOpenRouterApiKey()),
    provider: "openrouter",
    model: MODEL,
  };
}

function parseSuggestions(content: string): AiSuggestion[] {
  const candidates: string[] = [content.trim()];
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  const arrayStart = content.indexOf("[");
  const arrayEnd = content.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    candidates.push(content.slice(arrayStart, arrayEnd + 1));
  }

  let rawItems: Array<{
    severity?: "high" | "medium" | "low";
    title?: string;
    explanation?: string;
    suggestedFix?: string;
    line?: number;
  }> = [];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        rawItems = parsed as typeof rawItems;
        break;
      }
    } catch {
      continue;
    }
  }

  return rawItems
    .filter((item) => item.title && item.explanation && item.suggestedFix)
    .slice(0, 3)
    .map((item) => ({
      id: createId("ai"),
      severity: item.severity ?? "medium",
      title: item.title ?? "Замечание по коду",
      explanation: item.explanation ?? "Проверьте этот фрагмент кода.",
      suggestedFix: item.suggestedFix ?? "Уточните логику и добавьте проверку.",
      createdAt: new Date().toISOString(),
      relatedRange: item.line ? { startLine: item.line, endLine: item.line } : undefined,
    }));
}

function fallbackReview(context: MockReviewContext, message: string): AiReviewResult {
  return {
    suggestions: reviewCodeDiff(context),
    status: "fallback",
    source: "mock",
    message,
  };
}

export async function reviewCodeWithAi(context: MockReviewContext): Promise<AiReviewResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return fallbackReview(context, "Внешний AI не настроен, используется локальный анализатор.");
  }

  try {
    const prompt = `
Ты ИИ-наставник по программированию.
Сделай ревью Python-кода и отвечай строго на русском языке.

Код:
\`\`\`python
${context.nextCode}
\`\`\`

Найди от 1 до 3 важных замечаний (безопасность, надежность, сложность, читаемость).
Верни ответ только как JSON-массив:
[
  {
    "severity": "high" | "medium" | "low",
    "title": "Краткий заголовок на русском",
    "explanation": "Понятное объяснение на русском",
    "suggestedFix": "Конкретное исправление на русском",
    "line": 10
  }
]
Без markdown и без дополнительного текста.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://collabcode.ai",
        "X-Title": "CollabCode AI",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      const message = `OpenRouter returned ${response.status}. Local analyzer is used.${details ? ` Details: ${details.slice(0, 220)}` : ""}`;
      return fallbackReview(context, message);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return fallbackReview(context, "Пустой ответ внешнего AI, используется локальный анализатор.");
    }

    const suggestions = parseSuggestions(content);
    if (suggestions.length === 0) {
      return fallbackReview(context, "Ответ внешнего AI не распознан, используется локальный анализатор.");
    }

    return {
      suggestions,
      status: "ready",
      source: "openrouter",
      message: "Анализ завершен внешним AI.",
    };
  } catch (error) {
    console.error("AI review failed:", error);
    return fallbackReview(context, "Ошибка внешнего AI, используется локальный анализатор.");
  }
}

export async function resolveConflictWithAi(
  roomId: string,
  baseCode: string,
  userACode: string,
  userBCode: string,
): Promise<{ mergedCode: string; explanation: string }> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return {
      mergedCode: userACode,
      explanation: "ИИ не настроен для разрешения конфликтов.",
    };
  }

  try {
    const prompt = `
Пользователи одновременно изменили один и тот же фрагмент кода в комнате ${roomId}.
Отвечай строго на русском языке.

Базовый код:
${baseCode}

Версия A:
${userACode}

Версия B:
${userBCode}

Предложи итоговое объединение и кратко объясни решение.
Верни только JSON:
{
  "mergedCode": "полный код после объединения",
  "explanation": "объяснение на русском"
}
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return {
        mergedCode: userACode,
        explanation: `OpenRouter недоступен (${response.status}).`,
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { mergedCode: userACode, explanation: "Не удалось получить ответ от ИИ." };
    }

    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return { mergedCode: userACode, explanation: "Ответ ИИ имеет неверный формат." };
    }

    const parsed = JSON.parse(content.slice(start, end + 1)) as {
      mergedCode?: string;
      explanation?: string;
    };

    return {
      mergedCode: parsed.mergedCode ?? userACode,
      explanation: parsed.explanation ?? "Объединение выполнено с приоритетом версии A.",
    };
  } catch (error) {
    console.error("AI conflict resolution failed:", error);
    return { mergedCode: userACode, explanation: "Произошла ошибка при работе ИИ." };
  }
}

export async function getNavigatorAdvice(context: AiNavigatorContext): Promise<AiNavigatorResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    const topSuggestion = context.recentSuggestions[0] ?? "Сначала проверьте последние изменения и тесты комнаты.";
    return {
      source: "mock",
      answer: `Цель комнаты: ${context.goal}. Рекомендую: ${topSuggestion}`,
    };
  }

  try {
    const prompt = `
Ты AI-навигатор команды разработки. Отвечай только на русском, кратко и по делу.

Комната: ${context.roomId}
Цель: ${context.goal}
Вопрос участника: ${context.question}

Последние события:
${context.recentEvents.map((item) => `- ${item}`).join("\n")}

Последние замечания AI:
${context.recentSuggestions.map((item) => `- ${item}`).join("\n")}

Текущий код:
\`\`\`python
${context.code}
\`\`\`

Дай ответ:
1) что сделать прямо сейчас;
2) почему это приближает к цели;
3) какой следующий шаг после этого.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://collabcode.ai",
        "X-Title": "CollabCode AI Navigator",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return {
        source: "mock",
        answer: `Внешний AI недоступен (${response.status}). Начните с устранения последних high-risk замечаний и повторного запуска кода.`,
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        source: "mock",
        answer: "Ответ AI пустой. Проверьте критические замечания и разделите задачу на шаги по 20-30 минут.",
      };
    }

    return {
      source: "openrouter",
      answer: content.trim(),
    };
  } catch (error) {
    console.error("AI navigator failed:", error);
    return {
      source: "mock",
      answer: "Внешний AI временно недоступен. Сфокусируйтесь на последнем блокере и проверьте код локальным запуском.",
    };
  }
}
