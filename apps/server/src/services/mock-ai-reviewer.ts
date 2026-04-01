import type { AiSuggestion, MockReviewContext, SuggestionSeverity } from "@collabcode/shared";

import { createId } from "../lib/id.js";

function makeSuggestion(
  severity: SuggestionSeverity,
  title: string,
  explanation: string,
  suggestedFix: string,
  line?: number,
): AiSuggestion {
  return {
    id: createId("ai"),
    severity,
    title,
    explanation,
    suggestedFix,
    createdAt: new Date().toISOString(),
    relatedRange: line ? { startLine: line, endLine: line } : undefined,
  };
}

export function reviewCodeDiff(context: MockReviewContext): AiSuggestion[] {
  const suggestions: AiSuggestion[] = [];
  const nextLines = context.nextCode.split("\n");
  const previousCode = context.previousCode;
  const nextCode = context.nextCode;

  if (nextCode.includes("eval(") && !previousCode.includes("eval(")) {
    const line = nextLines.findIndex((lineItem) => lineItem.includes("eval(")) + 1;
    suggestions.push(
      makeSuggestion(
        "high",
        "Небезопасный вызов eval",
        "В диффе появился `eval`, а это может выполнить произвольный код и усложняет контроль безопасности.",
        "Замените `eval` на явный парсинг входных данных или словарь разрешенных операций.",
        line || undefined,
      ),
    );
  }

  if (nextCode.includes("print(") && !nextCode.includes("try:")) {
    const line = nextLines.findIndex((lineItem) => lineItem.includes("print(")) + 1;
    suggestions.push(
      makeSuggestion(
        "low",
        "Проверьте отладочный вывод",
        "В коде остался прямой `print`, что для демо допустимо, но в продакшен-потоке лучше структурированный лог.",
        "Если вывод нужен только для отладки, замените его на логгер или удалите перед релизом.",
        line || undefined,
      ),
    );
  }

  if (nextCode.includes("/ len(") && !nextCode.includes("if") && !previousCode.includes("/ len(")) {
    const line = nextLines.findIndex((lineItem) => lineItem.includes("/ len(")) + 1;
    suggestions.push(
      makeSuggestion(
        "medium",
        "Риск деления на ноль",
        "Вычисление среднего использует `len(...)` без видимой защиты от пустого списка.",
        "Добавьте ранний guard: если коллекция пустая, верните предсказуемый результат или бросьте понятную ошибку.",
        line || undefined,
      ),
    );
  }

  if (suggestions.length === 0 && nextCode !== previousCode) {
    suggestions.push(
      makeSuggestion(
        "low",
        "Изменение выглядит безопасно",
        "Локальный ИИ-проверяющий не нашел явных дефектов в новом диффе, но советует прогнать выполнение кода перед демонстрацией.",
        "Запустите код в песочнице и убедитесь, что вывод соответствует ожидаемому сценарию демо.",
      ),
    );
  }

  return suggestions.slice(0, 3);
}
