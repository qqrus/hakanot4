import type { AiSuggestion, MockReviewContext } from "@collabcode/shared";

import { createId } from "../lib/id.js";
import { reviewCodeDiff } from "./mock-ai-reviewer.js";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "arcee-ai/trinity-large-preview:free";

export async function reviewCodeWithAi(context: MockReviewContext): Promise<AiSuggestion[]> {
  if (!OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY не задан. Используется локальный ИИ-проверяющий.");
    return reviewCodeDiff(context);
  }

  try {
    const prompt = `
Ты ИИ-наставник по программированию.
Сделай ревью Python-кода и отвечай строго на русском языке.

Код:
\`\`\`python
${context.nextCode}
\`\`\`

Найди от 1 до 3 важных замечаний (безопасность, надёжность, сложность, читаемость).
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
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://collabcode.ai",
        "X-Title": "CollabCode AI",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        reasoning: { enabled: true },
      }),
    });

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return reviewCodeDiff(context);
    }

    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      return reviewCodeDiff(context);
    }

    const rawItems = JSON.parse(content.slice(start, end + 1)) as Array<{
      severity?: "high" | "medium" | "low";
      title?: string;
      explanation?: string;
      suggestedFix?: string;
      line?: number;
    }>;

    const items = rawItems
      .filter((item) => item.title && item.explanation && item.suggestedFix)
      .slice(0, 3);

    if (items.length === 0) {
      return reviewCodeDiff(context);
    }

    return items.map((item) => ({
      id: createId("ai"),
      severity: item.severity ?? "medium",
      title: item.title ?? "Замечание по коду",
      explanation: item.explanation ?? "Проверьте изменения в этом участке.",
      suggestedFix: item.suggestedFix ?? "Уточните логику и добавьте проверку.",
      createdAt: new Date().toISOString(),
      relatedRange: item.line ? { startLine: item.line, endLine: item.line } : undefined,
    }));
  } catch (error) {
    console.error("Ошибка ИИ-ревью:", error);
    return reviewCodeDiff(context);
  }
}

export async function resolveConflictWithAi(
  roomId: string,
  baseCode: string,
  userACode: string,
  userBCode: string,
): Promise<{ mergedCode: string; explanation: string }> {
  if (!OPENROUTER_API_KEY) {
    return { mergedCode: userACode, explanation: "ИИ не настроен для разрешения конфликтов." };
  }

  try {
    const prompt = `
Пользователи одновременно изменили один и тот же фрагмент кода в комнате ${roomId}.
Ответь строго на русском языке.

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
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        reasoning: { enabled: true },
      }),
    });

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
    console.error("Ошибка ИИ при разрешении конфликта:", error);
    return { mergedCode: userACode, explanation: "Произошла ошибка при работе ИИ." };
  }
}
