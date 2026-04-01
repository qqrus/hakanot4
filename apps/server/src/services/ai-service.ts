import type { AiSuggestion, MockReviewContext } from "@collabcode/shared";
import { env } from "../config/env.js";
import { createId } from "../lib/id.js";
import { reviewCodeDiff } from "./mock-ai-reviewer.js";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = "arcee-ai/trinity-large-preview:free";

export async function reviewCodeWithAi(context: MockReviewContext): Promise<AiSuggestion[]> {
  if (!OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY is not set. Falling back to mock reviewer.");
    return reviewCodeDiff(context);
  }

  try {
    const prompt = `
      Тебе нужно провести академическое ревью кода для студента.
      Язык программирования: Python.
      Текущий код:
      \`\`\`python
      ${context.nextCode}
      \`\`\`

      Твоя задача: найти 1-3 наиболее критичных момента (безопасность, антипаттерны, алгоритмическая сложность).
      Верни ответ в формате JSON:
      [
        {
          "severity": "high" | "medium" | "low",
          "title": "Краткое название",
          "explanation": "Подробное объяснение почему это важно",
          "suggestedFix": "Как исправить",
          "line": 10
        }
      ]
      Отвечай только JSON-массивом.
    `;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
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
    const content = data.choices[0].message.content;
    const start = content.indexOf("[");
    const end = content.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
      return reviewCodeDiff(context);
    }
    const items = JSON.parse(content.slice(start, end + 1));

    return items.map((item: any) => ({
      id: createId("ai"),
      severity: item.severity,
      title: item.title,
      explanation: item.explanation,
      suggestedFix: item.suggestedFix,
      createdAt: new Date().toISOString(),
      relatedRange: item.line ? { startLine: item.line, endLine: item.line } : undefined,
    }));
  } catch (error) {
    console.error("AI Review failed:", error);
    return reviewCodeDiff(context);
  }
}

export async function resolveConflictWithAi(
  roomId: string,
  baseCode: string,
  userACode: string,
  userBCode: string
): Promise<{ mergedCode: string; explanation: string }> {
  if (!OPENROUTER_API_KEY) {
    return { mergedCode: userACode, explanation: "AI не настроен для разрешения конфликтов." };
  }

  try {
    const prompt = `
      Два студента одновременно отредактировали один и тот же блок кода. 
      Базовый код:
      ${baseCode}

      Версия Студента А:
      ${userACode}

      Версия Студента Б:
      ${userBCode}

      Как эксперт, предложи оптимальное слияние этих изменений и объясни свое решение студентам.
      Верни JSON:
      {
        "mergedCode": "весь код после слияния",
        "explanation": "твое объяснение"
      }
      Отвечай только JSON.
    `;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        reasoning: { enabled: true },
      }),
    });

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content.substring(content.indexOf("{"), content.lastIndexOf("}") + 1));
  } catch (error) {
    console.error("AI Conflict resolution failed:", error);
    return { mergedCode: userACode, explanation: "Произошла ошибка при работе ИИ." };
  }
}
