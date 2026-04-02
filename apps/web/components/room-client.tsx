"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import {
  DEMO_ROOM_ID,
  DEFAULT_LANGUAGE,
  type AiSuggestion,
  type Participant,
  type RoomSnapshot,
  type SessionEvent,
  type TerminalLine,
} from "@collabcode/shared";
import clsx from "clsx";

import {
  CollaborationClient,
  type CollaborationParticipant,
} from "../lib/collaboration-client";
import { askNavigator, getAuthToken, getMe, getRoomMeta, joinRoomWithCode } from "../lib/platform-api";

import { PulseSphere } from "./ui/pulse-sphere";
import { AchievementToast } from "./ui/achievement-toast";

const EditorPane = dynamic(
  () => import("./editor-pane").then((module) => module.EditorPane),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm font-medium text-slate-400 animate-pulse">
        Инициализация редактора...
      </div>
    ),
  },
);

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const PROFILE_COLORS = ["#38BDF8", "#22C55E", "#F97316", "#F43F5E", "#8B5CF6"] as const;

interface RoomClientProps {
  roomId: string;
}

const emptyTerminal: RoomSnapshot["terminal"] = {
  status: "idle",
  lines: [],
};

const FADE_UP = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, type: "spring", bounce: 0.4 }
} as const;

function getTerminalStatusLabel(status: RoomSnapshot["terminal"]["status"]): string {
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

function getAiActivityLabel(level: "idle" | "active" | "error"): string {
  switch (level) {
    case "active":
      return "активен";
    case "error":
      return "ошибка";
    case "idle":
    default:
      return "ожидание";
  }
}

function getSeverityLabel(severity: AiSuggestion["severity"]): string {
  switch (severity) {
    case "high":
      return "высокий";
    case "medium":
      return "средний";
    case "low":
    default:
      return "низкий";
  }
}

function getEventTypeLabel(type: SessionEvent["type"]): string {
  switch (type) {
    case "achievement":
      return "достижение";
    case "rank-up":
      return "повышение";
    case "join":
      return "подключение";
    case "leave":
      return "выход";
    case "ai":
      return "ии-ревью";
    case "edit":
      return "редактирование";
    case "system":
      return "система";
    case "run":
      return "запуск";
    default:
      return type;
  }
}

function getProfileColor(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) | 0;
  }
  const normalized = Math.abs(hash) % PROFILE_COLORS.length;
  return PROFILE_COLORS[normalized] ?? PROFILE_COLORS[0];
}

export function RoomClient({ roomId }: RoomClientProps) {
  const [participant, setParticipant] = useState<CollaborationParticipant | null>(null);
  const [client, setClient] = useState<CollaborationClient | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [terminal, setTerminal] = useState<RoomSnapshot["terminal"]>(emptyTerminal);
  const [aiState, setAiState] = useState<RoomSnapshot["ai"]>({
    status: "idle",
    source: "mock",
    message: "Ожидание изменений кода.",
    updatedAt: new Date().toISOString(),
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [roomRole, setRoomRole] = useState<"owner" | "editor" | "viewer" | null>(null);
  const [navigatorQuestion, setNavigatorQuestion] = useState("");
  const [navigatorAnswer, setNavigatorAnswer] = useState<string | null>(null);
  const [isNavigatorLoading, setIsNavigatorLoading] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function resolveParticipant(): Promise<void> {
      const token = getAuthToken();
      if (!token) {
        setErrorMessage("Нужна авторизация. Перенаправляем на страницу входа...");
        window.setTimeout(() => {
          window.location.href = "/auth";
        }, 500);
        return;
      }

      try {
        const me = await getMe();
        if (disposed) {
          return;
        }
        setParticipant({
          id: me.id,
          name: me.name,
          avatar: me.avatar,
          color: getProfileColor(me.id),
          xp: 0,
          level: 1,
          rank: "Участник",
          isAnonymous: false,
          achievements: [],
        });
      } catch {
        if (disposed) {
          return;
        }
        setErrorMessage("Сессия недействительна. Перенаправляем на страницу входа...");
        window.setTimeout(() => {
          window.location.href = "/auth";
        }, 500);
      }
    }

    void resolveParticipant();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!participant) {
      return;
    }

    let activeParticipant = participant;
    let resolvedRole: "owner" | "editor" | "viewer" | null = null;
    let activeClient: CollaborationClient | null = null;

    async function bootstrap(): Promise<void> {
      setErrorMessage(null);
      setRoomRole(null);

      try {
        const meta = await getRoomMeta(roomId);
        resolvedRole = meta.membership.role;
        setRoomRole(resolvedRole);
      } catch {
        try {
          await joinRoomWithCode(roomId);
          const meta = await getRoomMeta(roomId);
          resolvedRole = meta.membership.role;
          setRoomRole(resolvedRole);
        } catch {
          if (roomId === DEMO_ROOM_ID) {
            resolvedRole = "editor";
            setRoomRole("editor");
          } else {
            throw new Error("Нет доступа к комнате. Войдите через кабинет или код доступа.");
          }
        }
      }

      const response = await fetch(`${SERVER_URL}/api/rooms/${roomId}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Не удалось загрузить состояние комнаты.");
      }

      const initialSnapshot = (await response.json()) as RoomSnapshot;
      setSnapshot(initialSnapshot);
      setParticipants(initialSnapshot.participants);
      setSuggestions(initialSnapshot.suggestions);
      setEvents(initialSnapshot.events);
      setTerminal(initialSnapshot.terminal);
      setAiState(initialSnapshot.ai);

      activeClient = new CollaborationClient(roomId, WS_URL, activeParticipant, {
        onRoomState: (nextSnapshot) => {
          startTransition(() => {
            setSnapshot(nextSnapshot);
            setParticipants(nextSnapshot.participants);
            setSuggestions(nextSnapshot.suggestions);
            setEvents(nextSnapshot.events);
            setTerminal(nextSnapshot.terminal);
            setAiState(nextSnapshot.ai);
          });
        },
        onEvent: (event) => {
          setEvents((currentEvents) => [event, ...currentEvents].slice(0, 40));
          if (event.type === "rank-up" || event.type === "achievement") {
            setToastMessage(event.message);
          }
        },
        onAiSuggestions: (nextSuggestions) => {
          setSuggestions(nextSuggestions);
        },
        onAiStatus: (state) => {
          setAiState(state);
        },
        onTerminalLine: (line: TerminalLine) => {
          setTerminal((currentTerminal) => ({
            ...currentTerminal,
            lines: [...currentTerminal.lines, line].slice(-200),
          }));
        },
        onExecutionStatus: (nextTerminal) => {
          setTerminal((currentTerminal) => ({
            ...currentTerminal,
            ...nextTerminal,
          }));
        },
        onParticipantJoined: (joinedParticipant) => {
          setParticipants((currentParticipants) => {
            const existing = currentParticipants.filter(
              (item) => item.id !== joinedParticipant.id,
            );
            return [joinedParticipant, ...existing];
          });
        },
        onParticipantLeft: (participantId) => {
          setParticipants((currentParticipants) =>
            currentParticipants.map((item) =>
              item.id === participantId
                ? { ...item, status: "offline", lastSeenAt: new Date().toISOString() }
                : item,
            ),
          );
        },
        onError: (message) => setErrorMessage(message),
        onConnectionChange: (nextConnected) => setConnected(nextConnected),
      }, {
        canEdit: resolvedRole !== "viewer",
        authToken: getAuthToken(),
      });

      activeClient.connect();
      setClient(activeClient);
    }

    bootstrap().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Ошибка загрузки комнаты.");
    });

    return () => {
      activeClient?.dispose();
      setClient(null);
      setConnected(false);
    };
  }, [participant, roomId]);

  const participantLabel = participant ? participant.name : "Подготовка профиля...";

  const aiActivityLevel = useMemo(() => {
    if (errorMessage) return "error";
    if (aiState.status === "processing") return "active";
    if (aiState.status === "error") return "error";
    if (aiState.status === "ready" || aiState.status === "fallback") return "active";
    return "idle";
  }, [aiState.status, errorMessage]);
  const isViewer = roomRole === "viewer";

  const roomKpi = useMemo(() => {
    const online = participants.filter((item) => item.status === "online").length;
    const editsLast5m = events.filter((event) => {
      if (event.type !== "edit") {
        return false;
      }
      const ts = new Date(event.createdAt).getTime();
      return Number.isFinite(ts) && Date.now() - ts <= 5 * 60 * 1000;
    }).length;
    const criticalFindings = suggestions.filter((item) => item.severity === "high").length;
    return {
      online,
      editsPerMinute: Number((editsLast5m / 5).toFixed(2)),
      criticalFindings,
    };
  }, [participants, events, suggestions]);

  const submitNavigatorQuestion = async (): Promise<void> => {
    if (!navigatorQuestion.trim()) {
      return;
    }
    setIsNavigatorLoading(true);
    try {
      const result = await askNavigator(roomId, navigatorQuestion.trim());
      setNavigatorAnswer(result.answer);
    } catch (error) {
      setNavigatorAnswer(error instanceof Error ? error.message : "Не удалось получить ответ AI-навигатора.");
    } finally {
      setIsNavigatorLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-5 font-sans relative overflow-hidden bg-transparent text-slate-800 lg:px-6">
      <AchievementToast message={toastMessage} onClose={() => setToastMessage(null)} />
      
      {/* Animated Aurora Light Background Elements */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-50 overflow-hidden mix-blend-multiply">
        <div className="absolute -top-1/4 -right-1/4 w-[80%] h-[80%] rounded-full bg-accent/40 blur-[160px] animate-aurora mix-blend-screen" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[80%] h-[80%] rounded-full bg-primary/30 blur-[180px] animate-aurora transition-transform mix-blend-screen" style={{ animationDelay: '-5s' }} />
      </div>

      <div className="mx-auto flex max-w-[1800px] flex-col gap-6 relative z-10 p-2">
        <motion.header 
          {...FADE_UP} 
          className="flex flex-col gap-4 rounded-[2rem] border border-white/60 bg-white/70 p-5 shadow-panel backdrop-blur-2xl md:flex-row md:items-center md:justify-between"
        >
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 bg-gradient-to-tr from-primary/80 to-accent/80 rounded-2xl animate-spin-slow flex items-center justify-center shadow-lg transform rotate-12">
              <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center shadow-inner">
                <span className="text-transparent bg-clip-text bg-gradient-to-br from-primary to-accent text-sm font-black">CAI</span>
              </div>
            </div>
            <div>
              <Link href="/" className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">
                Платформа CollabCode
              </Link>
              <h1 className="mt-1 text-3xl font-extrabold text-slate-800 tracking-tight">
                Комната <span className="text-slate-300">/</span> {roomId}
              </h1>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-2xl bg-white px-5 py-2.5 text-[11px] font-black uppercase text-slate-500 shadow-sm border border-slate-100 flex items-center">
              <span className={clsx("inline-block w-2.5 h-2.5 rounded-full mr-3 shadow-inner", connected ? "bg-accent" : "bg-primary animate-pulse")} />
              {connected ? "СИНХРОНИЗИРОВАНО" : "ПОДКЛЮЧЕНИЕ"}
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/40 px-5 py-2.5 text-xs font-semibold flex items-center gap-2 shadow-sm">
              Профиль:
              <span className="font-extrabold" style={{ color: participant?.color ?? "#38BDF8" }}>
                {participantLabel}
              </span>
            </div>
            <button
              disabled={!client || !snapshot || isViewer}
              onClick={() => { if (isViewer) { return; } client?.runCode({ roomId, language: "python", code: client.doc.getText("monaco").toString() }); }}
              className="rounded-2xl bg-slate-800 px-8 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-95 hover:bg-slate-900 disabled:opacity-50"
            >
              {isViewer ? "Только просмотр" : "Запустить"}
            </button>
          </div>
        </motion.header>

        {errorMessage && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm font-semibold text-primary shadow-sm">
            <span className="mr-3 text-xl">⚠️</span> {errorMessage}
          </motion.div>
        )}
        {isViewer && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm font-semibold text-warning shadow-sm">
            Режим viewer: редактирование и запуск кода отключены для этой комнаты.
          </motion.div>
        )}

        <section className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
          {/* Main IDE Area - Claymorphism Bento */}
          <div className="grid gap-6 xl:grid-rows-[minmax(560px,1fr)_260px]">
            <motion.div 
              {...FADE_UP} transition={{ delay: 0.1 }}
              className="group relative flex flex-col overflow-hidden rounded-[2.5rem] border border-white bg-white/60 backdrop-blur-3xl shadow-panel transition-all hover:shadow-lg"
            >
              <div className="flex items-center justify-between border-b border-slate-200/50 px-8 py-5 text-xs font-bold tracking-widest uppercase bg-white/40">
                <span className="text-slate-500">{snapshot?.fileName ?? "main.py"}</span>
                <span className="text-slate-600 bg-slate-100/80 px-4 py-1.5 rounded-full shadow-inner">{snapshot?.language ?? DEFAULT_LANGUAGE}</span>
              </div>
              <div className="flex-1 relative bg-white/50 backdrop-blur-sm">
                {client ? (
                  <EditorPane
                    doc={client.doc}
                    awareness={client.awareness}
                    language={snapshot?.language ?? DEFAULT_LANGUAGE}
                    readOnly={isViewer}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-medium text-slate-400 animate-pulse">
                    {"Подготовка рабочего пространства..."}
                  </div>
                )}
              </div>
            </motion.div>

            {/* Terminal Panel */}
            <motion.div {...FADE_UP} transition={{ delay: 0.2 }} className="rounded-[2rem] border border-white bg-white/70 p-6 shadow-panel backdrop-blur-2xl relative overflow-hidden xl:sticky xl:bottom-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-pulse" /> Консоль
                </h2>
                <span className={clsx("text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-sm", 
                  terminal.status === "running" ? "text-warning bg-warning/10 border border-warning/20" :
                  terminal.status === "success" ? "text-success bg-success/10 border border-success/20" :
                  terminal.status === "error" ? "text-primary bg-primary/10 border border-primary/20" :
                  "text-slate-500 bg-slate-100 border border-slate-200"
                )}>
                  {getTerminalStatusLabel(terminal.status)}
                </span>
              </div>
              <div className="mt-5 h-[160px] overflow-y-auto rounded-2xl bg-slate-50 p-5 font-mono text-[13px] shadow-inner custom-scrollbar relative border border-slate-200/50">
                {terminal.lines.length > 0 ? (
                  terminal.lines.map((line) => (
                    <div
                      key={line.id}
                      className={clsx(
                        "mb-2 whitespace-pre-wrap leading-relaxed",
                        line.stream === "stderr" && "text-primary font-medium",
                        line.stream === "stdout" && "text-slate-600",
                        line.stream === "system" && "text-accent font-semibold",
                      )}
                    >
                      <span className="opacity-30 mr-3 text-slate-400">{">"}</span>{line.text}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400/60 flex h-full items-center justify-center italic text-sm">
                    Готово к запуску.
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Sidebar Bento Components */}
          <aside className="grid gap-6">
            <motion.div
              {...FADE_UP}
              transition={{ delay: 0.28 }}
              className="rounded-[2.5rem] border border-white bg-white/70 p-5 shadow-panel backdrop-blur-2xl"
            >
              <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">
                Состояние комнаты сейчас
              </h2>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Онлайн</p>
                  <p className="mt-1 text-lg font-black text-slate-800">{roomKpi.online}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Темп</p>
                  <p className="mt-1 text-lg font-black text-slate-800">{roomKpi.editsPerMinute}/мин</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">High-risk</p>
                  <p className={clsx("mt-1 text-lg font-black", roomKpi.criticalFindings > 0 ? "text-primary" : "text-success")}>
                    {roomKpi.criticalFindings}
                  </p>
                </div>
              </div>
            </motion.div>

            {/* 3D Glass AI Visualization */}
            <motion.div {...FADE_UP} transition={{ delay: 0.3 }} className="rounded-[2.5rem] border border-white bg-white/40 p-6 shadow-panel backdrop-blur-3xl relative overflow-hidden flex min-h-[280px] flex-col items-center justify-center group pointer-events-auto isolate">
              {/* Soft spotlight behind the glass */}
              <div className={clsx("absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full blur-3xl opacity-80 transition-all duration-1000", aiState.status === "processing" ? "bg-accent scale-150" : "bg-white")} />
              
              <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 absolute top-6 left-6 z-10">
                ИИ-ассистент
              </h2>
              
              <div className="absolute inset-0 z-0">
                <PulseSphere activityLevel={aiActivityLevel} />
              </div>
              
              <div className="absolute bottom-6 z-10 bg-white/60 px-4 py-1.5 rounded-full border border-white shadow-sm text-[10px] font-black text-slate-500 uppercase tracking-widest backdrop-blur-md flex items-center gap-2">
                Статус: <span className={clsx(
                  aiActivityLevel === 'active' ? 'text-accent animate-pulse' : 
                  aiActivityLevel === 'error' ? 'text-primary' : 'text-slate-500'
                )}>
                  {aiState.status === "processing"
                    ? "обработка..."
                    : aiState.status === "fallback"
                      ? "локальный режим"
                      : getAiActivityLabel(aiActivityLevel)}
                </span>
                {aiState.status === "processing" && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />}
              </div>
            </motion.div>

            {/* AI Review Details Bento */}
            <motion.div {...FADE_UP} transition={{ delay: 0.4 }} className="rounded-[2.5rem] border border-white bg-white/70 p-6 shadow-panel backdrop-blur-2xl max-h-[420px] flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Анализ</h2>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{suggestions.length} подсказок</span>
              </div>
              <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 flex-1">
                {suggestions.length > 0 ? (
                  suggestions.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:bg-slate-50/80 group">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-bold text-slate-800">{item.title}</h3>
                        <span className={clsx(
                          "rounded-lg px-2.5 py-1 text-[9px] uppercase font-black tracking-widest text-white shadow-sm",
                          item.severity === "high" && "bg-primary",
                          item.severity === "medium" && "bg-warning",
                          item.severity === "low" && "bg-accent/80",
                        )}>{getSeverityLabel(item.severity)}</span>
                      </div>
                      <p className="mt-3 text-[13px] text-slate-600 leading-relaxed">{item.explanation}</p>
                      <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100 text-[12px] font-mono text-slate-700 shadow-inner">
                        <span className="font-bold text-accent mr-2">Исправление:</span>{item.suggestedFix}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex items-center justify-center flex-col text-center opacity-60">
                    <p className="text-sm font-semibold text-slate-500">Критичных замечаний не найдено.</p>
                    <p className="mt-1 text-xs text-slate-400">ИИ продолжает мониторинг новых правок.</p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* AI Navigator */}
            <motion.div {...FADE_UP} transition={{ delay: 0.45 }} className="rounded-[2.5rem] border border-white bg-white/70 p-6 shadow-panel backdrop-blur-2xl">
              <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">AI-навигатор</h2>
              <p className="mt-2 text-xs text-slate-500">Спроси, какой следующий шаг сделать по цели комнаты.</p>
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                Темп команды: скорость правок (edit-события/мин). Пропускная способность: сейчас считается тем же показателем, то есть edits/min.
              </div>
              <textarea
                value={navigatorQuestion}
                onChange={(event) => setNavigatorQuestion(event.target.value)}
                rows={3}
                placeholder="Например: как сейчас ускорить достижение цели комнаты?"
                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void submitNavigatorQuestion()}
                disabled={isNavigatorLoading || navigatorQuestion.trim().length === 0}
                className="mt-3 rounded-xl bg-slate-800 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-white disabled:opacity-50"
              >
                {isNavigatorLoading ? "Анализ..." : "Спросить навигатор"}
              </button>
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {navigatorAnswer ?? "Ответ появится здесь."}
              </div>
            </motion.div>

            {/* Live Event Feed Bento */}
            <motion.div {...FADE_UP} transition={{ delay: 0.5 }} className="rounded-[2.5rem] border border-white bg-white/70 p-6 shadow-panel backdrop-blur-2xl overflow-hidden flex flex-col h-[340px]">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-primary">Лента событий</h2>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-primary rounded-full shadow-[0_0_8px_rgba(251,113,133,0.6)] animate-pulse" />
                </div>
              </div>
              <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 h-[250px]">
                {events.length > 0 ? events.map((item) => (
                  <div key={item.id} className="relative pl-5 border-l-2 border-slate-200 py-1.5 ml-2">
                    <div className="absolute -left-[7px] top-3 w-3 h-3 rounded-full bg-white border-2 border-slate-300 shadow-sm" />
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      {getEventTypeLabel(item.type)} <span className="text-slate-300 ml-3 font-medium">{new Date(item.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-1.5 text-[13px] text-slate-700 font-semibold">{item.message}</div>
                  </div>
                )) : (
                  <div className="text-center text-sm font-medium text-slate-400 italic mt-12">Ожидание активности...</div>
                )}
              </div>
            </motion.div>
          </aside>
        </section>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.3);
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.6);
        }
      `}</style>
    </main>
  );
}

