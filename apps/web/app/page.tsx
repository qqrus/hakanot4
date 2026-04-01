"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  ChartNoAxesCombined,
  Eye,
  EyeOff,
  Gauge,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import clsx from "clsx";

import { DEMO_ROOM_ID } from "@collabcode/shared";

const HomeTechScene = dynamic(
  () => import("../components/ui/home-tech-scene").then((mod) => mod.HomeTechScene),
  { ssr: false },
);

const PulseSphere = dynamic(
  () => import("../components/ui/pulse-sphere").then((mod) => mod.PulseSphere),
  { ssr: false },
);

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

interface HomeMetrics {
  roomId: string;
  participants: { online: number; total: number };
  ai: {
    suggestions: number;
    severity: { low: number; medium: number; high: number };
    reactionMs: number | null;
    scores: { security: number; complexity: number; readability: number; performance: number };
  };
  execution: { status: "idle" | "running" | "success" | "error" | "timeout" };
  trend: number[];
  throughputPerMinute: number;
  syncRate: number;
  model: string;
  core: {
    collaborationIndex: number;
    suggestionLoad: number;
    stabilityIndex: number;
  };
  recentEvents: Array<{
    id: string;
    type: "join" | "leave" | "edit" | "run" | "ai" | "system" | "achievement" | "rank-up";
    typeLabel: string;
    message: string;
    actorName: string | null;
    createdAt: string;
    risk: "low" | "medium" | "high";
    status: "ok" | "attention" | "idle" | "running" | "success" | "error" | "timeout";
  }>;
}

const defaultMetrics: HomeMetrics = {
  roomId: DEMO_ROOM_ID,
  participants: { online: 0, total: 0 },
  ai: {
    suggestions: 0,
    severity: { low: 0, medium: 0, high: 0 },
    reactionMs: null,
    scores: { security: 82, complexity: 79, readability: 88, performance: 80 },
  },
  execution: { status: "idle" },
  trend: Array.from({ length: 12 }, () => 0),
  throughputPerMinute: 0,
  syncRate: 100,
  model: "arcee-ai/trinity-large-preview",
  core: {
    collaborationIndex: 0,
    suggestionLoad: 0,
    stabilityIndex: 0.8,
  },
  recentEvents: [],
};

function getExecutionStatusLabel(status: HomeMetrics["execution"]["status"]): string {
  switch (status) {
    case "running":
      return "выполняется";
    case "success":
      return "успех";
    case "error":
      return "ошибка";
    case "timeout":
      return "тайм-аут";
    case "idle":
    default:
      return "ожидание";
  }
}

function linePath(values: number[], width: number, height: number): string {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const spread = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / spread) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(values: number[], width: number, height: number): string {
  const line = linePath(values, width, height);
  return `${line} L ${width},${height} L 0,${height} Z`;
}

function getRiskLabel(risk: "low" | "medium" | "high"): string {
  switch (risk) {
    case "high":
      return "высокий";
    case "medium":
      return "средний";
    case "low":
    default:
      return "низкий";
  }
}

function getRowStatusLabel(
  status: "ok" | "attention" | "idle" | "running" | "success" | "error" | "timeout",
): string {
  switch (status) {
    case "ok":
      return "норма";
    case "attention":
      return "внимание";
    case "running":
      return "выполняется";
    case "success":
      return "успех";
    case "error":
      return "ошибка";
    case "timeout":
      return "тайм-аут";
    case "idle":
    default:
      return "ожидание";
  }
}

function getRowStatusTone(
  status: "ok" | "attention" | "idle" | "running" | "success" | "error" | "timeout",
): string {
  switch (status) {
    case "success":
    case "ok":
      return "border-success/25 bg-success/10 text-success";
    case "running":
    case "attention":
      return "border-warning/25 bg-warning/10 text-warning";
    case "error":
    case "timeout":
      return "border-primary/25 bg-primary/10 text-primary";
    case "idle":
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

export default function HomePage() {
  const [roomId, setRoomId] = useState(DEMO_ROOM_ID);
  const [plan] = useState("Команда Pro");
  const [explainMode, setExplainMode] = useState(true);
  const [metrics, setMetrics] = useState<HomeMetrics>(defaultMetrics);
  const [backendOnline, setBackendOnline] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>(new Date().toISOString());

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    const loadMetrics = async (): Promise<void> => {
      const startedAt = performance.now();
      try {
        const response = await fetch(
          `${SERVER_URL}/api/home/${encodeURIComponent(roomId || DEMO_ROOM_ID)}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error(`Metrics request failed with ${response.status}`);
        }

        const payload = (await response.json()) as HomeMetrics;
        if (disposed) {
          return;
        }

        setMetrics(payload);
        setBackendOnline(true);
        setLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
        setLastUpdatedAt(new Date().toISOString());
      } catch {
        if (disposed) {
          return;
        }
        setBackendOnline(false);
      }
    };

    void loadMetrics();
    timer = window.setInterval(() => {
      void loadMetrics();
    }, 3500);

    return () => {
      disposed = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [roomId]);

  const trendLine = useMemo(() => linePath(metrics.trend, 640, 220), [metrics.trend]);
  const trendArea = useMemo(() => areaPath(metrics.trend, 640, 220), [metrics.trend]);
  const trendPeak = useMemo(() => Math.max(...metrics.trend, 0), [metrics.trend]);

  const aiFindings = useMemo(
    () => [
      { label: "Безопасность", value: metrics.ai.scores.security, tone: "bg-primary" },
      { label: "Сложность", value: metrics.ai.scores.complexity, tone: "bg-warning" },
      { label: "Читаемость", value: metrics.ai.scores.readability, tone: "bg-accent" },
      { label: "Производительность", value: metrics.ai.scores.performance, tone: "bg-success" },
    ],
    [metrics.ai.scores],
  );

  const aiActivityLevel = useMemo(() => {
    if (metrics.execution.status === "error" || metrics.execution.status === "timeout") {
      return "error" as const;
    }
    if (metrics.execution.status === "running" || metrics.ai.suggestions > 0) {
      return "active" as const;
    }
    return "idle" as const;
  }, [metrics.execution.status, metrics.ai.suggestions]);

  const throughputTone = useMemo(() => {
    if (metrics.throughputPerMinute >= 2) return "text-success";
    if (metrics.throughputPerMinute >= 0.8) return "text-warning";
    return "text-primary";
  }, [metrics.throughputPerMinute]);

  const judgeCards = useMemo(
    () => [
      {
        title: "Индекс стабильности",
        value: `${Math.round(metrics.core.stabilityIndex * 100)}%`,
        hint: "Безопасность + рантайм",
        icon: ShieldAlert,
        tone: metrics.core.stabilityIndex >= 0.8 ? "text-success" : "text-warning",
      },
      {
        title: "Индекс синхронизации",
        value: `${metrics.syncRate}%`,
        hint: `${metrics.participants.online}/${Math.max(metrics.participants.total, 1)} участников онлайн`,
        icon: Users,
        tone: metrics.syncRate >= 80 ? "text-accent" : "text-warning",
      },
      {
        title: "Темп комнаты",
        value: `${metrics.throughputPerMinute}/мин`,
        hint: "Правки за последние 60 минут",
        icon: Gauge,
        tone: metrics.throughputPerMinute >= 0.8 ? "text-primary" : "text-slate-500",
      },
    ],
    [metrics.core.stabilityIndex, metrics.syncRate, metrics.participants.online, metrics.participants.total, metrics.throughputPerMinute],
  );

  const hybridRows = useMemo(() => {
    const metricRows = [
      {
        id: "metric-sync",
        kind: "Метрика",
        what: "Синхронизация команды",
        value: `${metrics.syncRate}%`,
        time: "сейчас",
        risk: metrics.syncRate >= 80 ? "low" : "medium",
        status: "ok",
      },
      {
        id: "metric-ai",
        kind: "Метрика",
        what: "Нагрузка ИИ-ревью",
        value: `${metrics.ai.suggestions} замечаний`,
        time: "сейчас",
        risk:
          metrics.ai.severity.high > 0
            ? "high"
            : metrics.ai.severity.medium > 0
              ? "medium"
              : "low",
        status: metrics.ai.severity.high > 0 ? "attention" : "ok",
      },
      {
        id: "metric-run",
        kind: "Метрика",
        what: "Статус исполнения",
        value: getExecutionStatusLabel(metrics.execution.status),
        time: "сейчас",
        risk:
          metrics.execution.status === "error" || metrics.execution.status === "timeout"
            ? "high"
            : metrics.execution.status === "running"
              ? "medium"
              : "low",
        status: metrics.execution.status,
      },
    ] as const;

    const eventRows = metrics.recentEvents.slice(0, 7).map((event) => ({
      id: event.id,
      kind: event.typeLabel,
      what: event.actorName ? `${event.actorName}: ${event.message}` : event.message,
      value: event.type === "ai" ? `${metrics.ai.suggestions} активных` : event.typeLabel,
      time: new Date(event.createdAt).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      risk: event.risk,
      status: event.status,
    }));

    return [...metricRows, ...eventRows];
  }, [metrics]);

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-5 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-36 top-10 h-80 w-80 rounded-full bg-accent/25 blur-[120px]" />
        <div className="absolute -right-20 top-24 h-72 w-72 rounded-full bg-primary/20 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-success/15 blur-[180px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1500px]">
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/70 bg-white/65 px-5 py-4 shadow-panel backdrop-blur-2xl"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-primary text-xs font-black text-white shadow-neon-pink">
              CC
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                Система CollabCode
              </p>
              <h1 className="text-xl font-black tracking-tight text-ink lg:text-2xl">
                Платформа совместной разработки с ИИ
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">
              Тариф: {plan}
            </span>
            <span
              className={clsx(
                "rounded-full px-3 py-1 text-[11px] font-bold",
                backendOnline
                  ? "border border-success/30 bg-success/10 text-success"
                  : "border border-primary/30 bg-primary/10 text-primary",
              )}
            >
              {backendOnline ? "Бэкенд онлайн" : "Бэкенд офлайн"}
            </span>
            <Link
              href={`/room/${DEMO_ROOM_ID}`}
              className="rounded-full bg-ink px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white transition hover:opacity-90"
            >
              Открыть демо
            </Link>
          </div>
        </motion.header>

        <section className="grid gap-5 lg:grid-cols-12">
          <motion.div
            initial={{ opacity: 0, x: -28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="relative overflow-hidden rounded-[34px] border border-white/80 bg-white/70 p-7 shadow-panel backdrop-blur-2xl lg:col-span-7"
          >
            <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-accent/10 to-transparent" />
            <div className="relative">
              <p className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                <Sparkles size={13} />
                Дашборд в реальном времени
              </p>

              <h2 className="mt-5 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight text-ink lg:text-6xl">
                Судейский режим: сразу видно, что происходит в комнате прямо сейчас.
              </h2>

              <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 lg:text-lg">
                Все блоки на странице связаны с backend-метриками выбранной комнаты: активность, риски ИИ, исполнение и события участников.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  id="roomId"
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-800 shadow-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  placeholder="demo-room"
                />
                <Link
                  href={`/room/${encodeURIComponent(roomId || DEMO_ROOM_ID)}`}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-accent to-primary px-6 py-3 text-sm font-black uppercase tracking-wide text-white shadow-neon-pink transition hover:brightness-105"
                >
                  Войти в комнату <ArrowUpRight size={16} />
                </Link>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {judgeCards.map((item, index) => (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.18 + index * 0.08 }}
                    className="rounded-2xl border border-slate-200/80 bg-white/90 p-4"
                  >
                    <item.icon size={16} className={clsx("mb-3", item.tone)} />
                    <div className="text-2xl font-black leading-none text-ink">{item.value}</div>
                    <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      {item.title}
                    </div>
                    <div className="mt-2 text-xs font-medium text-slate-500">{item.hint}</div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 text-xs font-semibold text-slate-600">
                Последнее обновление: {new Date(lastUpdatedAt).toLocaleTimeString("ru-RU")} ·
                {" "}
                Отклик API: {latencyMs ? `${latencyMs}мс` : "н/д"}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="relative overflow-hidden rounded-[34px] border border-white/75 bg-white/55 p-5 shadow-panel backdrop-blur-2xl lg:col-span-5"
          >
            <div className="absolute left-4 top-4 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              3D-ядро по данным
            </div>
            <button
              type="button"
              onClick={() => setExplainMode((prev) => !prev)}
              className="absolute right-4 top-4 z-20 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-600"
            >
              {explainMode ? <Eye size={12} /> : <EyeOff size={12} />}
              Объяснить
            </button>
            <div className="relative h-[360px] rounded-[24px] border border-white/70 bg-gradient-to-br from-slate-900/20 via-slate-700/10 to-accent/10">
              <HomeTechScene
                collaborationIndex={metrics.core.collaborationIndex}
                suggestionLoad={metrics.core.suggestionLoad}
                stabilityIndex={metrics.core.stabilityIndex}
                executionStatus={metrics.execution.status}
                throughputPerMinute={metrics.throughputPerMinute}
                highSeverityCount={metrics.ai.severity.high}
                recentEventsCount={metrics.recentEvents.length}
              />
              {explainMode && (
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-[45%] top-[48%] rounded-lg border border-white/70 bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-700">
                    Планета = синхронизация команды
                  </div>
                  <div className="absolute left-[60%] top-[20%] rounded-lg border border-white/70 bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-700">
                    Орбиты = темп правок
                  </div>
                  <div className="absolute left-[16%] top-[65%] rounded-lg border border-white/70 bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-700">
                    Вспышки = события и риски
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Задержка", latencyMs ? `${latencyMs}ms` : "н/д"],
                ["Синхронизация", `${metrics.syncRate}%`],
                ["Пропускная способность", `${metrics.throughputPerMinute}/мин`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/70 bg-white/75 p-3">
                  <div className={clsx("text-lg font-black text-ink", label === "Пропускная способность" && throughputTone)}>
                    {value}
                  </div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-2xl border border-slate-200/70 bg-white/80 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Что показывает 3D-модель
              </p>
              <div className="mt-2 grid gap-2 text-xs font-medium text-slate-600 sm:grid-cols-2">
                <p>
                  <span className="font-black text-slate-800">Размер планеты:</span> доля активных участников в комнате
                </p>
                <p>
                  <span className="font-black text-slate-800">Скорость орбит:</span> пропускная способность (правки в минуту)
                </p>
                <p>
                  <span className="font-black text-slate-800">Красная луна:</span> количество критичных замечаний ИИ
                </p>
                <p>
                  <span className="font-black text-slate-800">Внешний ореол:</span> индекс стабильности комнаты
                </p>
                <p className="sm:col-span-2">
                  <span className="font-black text-slate-800">Цвет планеты:</span> текущее состояние запуска ({getExecutionStatusLabel(metrics.execution.status)})
                </p>
              </div>
            </div>
          </motion.div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-12">
          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.2 }}
            className="rounded-[30px] border border-white/75 bg-white/70 p-6 shadow-panel backdrop-blur-2xl lg:col-span-8"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-ink">Пульс совместной работы</h3>
                <p className="text-sm text-slate-500">Активность правок из backend-событий (последние 60 минут)</p>
              </div>
              <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
                Пик {trendPeak}/5м
              </span>
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4">
              <svg viewBox="0 0 640 220" className="h-64 w-full">
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(56, 189, 248, 0.35)" />
                    <stop offset="100%" stopColor="rgba(56, 189, 248, 0.02)" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((line) => (
                  <line
                    key={line}
                    x1="0"
                    x2="640"
                    y1={line * 55}
                    y2={line * 55}
                    stroke="rgba(148, 163, 184, 0.25)"
                    strokeDasharray="4 8"
                  />
                ))}
                <path d={trendArea} fill="url(#trendFill)" />
                <path d={trendLine} stroke="#38BDF8" strokeWidth="4" fill="none" />
              </svg>
            </div>
          </motion.article>

          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.26 }}
            className="rounded-[30px] border border-white/75 bg-white/70 p-6 shadow-panel backdrop-blur-2xl lg:col-span-4"
          >
            <div className="mb-4 flex items-center gap-2">
              <ChartNoAxesCombined size={18} className="text-primary" />
              <h3 className="text-lg font-black text-ink">Матрица ИИ-ревью</h3>
            </div>
            <div className="space-y-4">
              {aiFindings.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-sm font-semibold text-slate-600">
                    <span>{item.label}</span>
                    <span>{item.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${item.value}%` }}
                      transition={{ duration: 0.9, delay: 0.2 }}
                      className={clsx("h-2 rounded-full", item.tone)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white/85 p-3 text-sm text-slate-600">
              Модель: <span className="font-black text-slate-800">{metrics.model}</span>
            </div>
          </motion.article>

          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.32 }}
            className="rounded-[30px] border border-white/75 bg-white/70 p-5 shadow-panel backdrop-blur-2xl lg:col-span-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black text-ink">3D-индикатор рантайма</h3>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                {getExecutionStatusLabel(metrics.execution.status)}
              </span>
            </div>
            <div className="h-[220px] rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-900/20 via-white/70 to-accent/10">
              <PulseSphere activityLevel={aiActivityLevel} />
            </div>
          </motion.article>

          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.38 }}
            className="rounded-[30px] border border-white/75 bg-white/70 p-6 shadow-panel backdrop-blur-2xl lg:col-span-7"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-ink">Контроль комнаты: метрики + события</h3>
                <p className="text-sm text-slate-500">Гибридная таблица для жюри и пользователей, обновляется в реальном времени</p>
              </div>
              <Activity size={18} className="text-accent" />
            </div>
            <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/90">
              <div className="grid grid-cols-[1fr_2.2fr_1fr_0.9fr_1fr] gap-3 border-b border-slate-200/80 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                <span>Источник</span>
                <span>Что происходит</span>
                <span>Показатель</span>
                <span>Риск</span>
                <span>Состояние</span>
              </div>
              <div className="max-h-[350px] overflow-y-auto">
                {hybridRows.map((row, index) => (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(0.02 * index, 0.22) }}
                    className="grid grid-cols-[1fr_2.2fr_1fr_0.9fr_1fr] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-none hover:bg-slate-50/80"
                  >
                    <span className="inline-flex items-center gap-2 font-bold text-slate-700">
                      <span className="h-2 w-2 rounded-full bg-accent" />
                      {row.kind}
                    </span>
                    <span className="font-medium text-slate-600">{row.what}</span>
                    <span className="font-bold text-ink">{row.value}</span>
                    <span
                      className={clsx(
                        "inline-flex w-fit items-center rounded-full px-2 py-1 text-[11px] font-black uppercase tracking-wide",
                        row.risk === "high"
                          ? "bg-primary/10 text-primary"
                          : row.risk === "medium"
                            ? "bg-warning/10 text-warning"
                            : "bg-success/10 text-success",
                      )}
                    >
                      {getRiskLabel(row.risk)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase tracking-wide",
                          getRowStatusTone(row.status),
                        )}
                      >
                        {getRowStatusLabel(row.status)}
                      </span>
                      <span className="text-xs text-slate-400">{row.time}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.article>
        </section>

        <motion.footer
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.42 }}
          className="mt-5 rounded-[24px] border border-white/80 bg-white/65 px-5 py-4 text-sm text-slate-500 shadow-panel backdrop-blur-xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-medium">Откройте комнату и наблюдайте, как метрики и события обновляются вживую.</p>
            <Link
              href={`/room/${DEMO_ROOM_ID}`}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 transition hover:border-accent hover:text-accent"
            >
              Открыть комнату <ArrowUpRight size={14} />
            </Link>
          </div>
        </motion.footer>
      </div>
    </main>
  );
}
