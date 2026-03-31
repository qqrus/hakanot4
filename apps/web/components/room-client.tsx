"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";

import {
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
import { getLocalIdentity, rotateLocalIdentity } from "../lib/identity";

const EditorPane = dynamic(
  () => import("./editor-pane").then((module) => module.EditorPane),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Загружаем Monaco Editor...
      </div>
    ),
  },
);

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

interface RoomClientProps {
  roomId: string;
}

const emptyTerminal: RoomSnapshot["terminal"] = {
  status: "idle",
  lines: [],
};

export function RoomClient({ roomId }: RoomClientProps) {
  const [participant, setParticipant] = useState<CollaborationParticipant | null>(null);
  const [client, setClient] = useState<CollaborationClient | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [terminal, setTerminal] = useState<RoomSnapshot["terminal"]>(emptyTerminal);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setParticipant(getLocalIdentity());
  }, []);

  useEffect(() => {
    if (!participant) {
      return;
    }

    const activeParticipant = participant;
    let activeClient: CollaborationClient | null = null;

    async function bootstrap(): Promise<void> {
      setErrorMessage(null);

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

      activeClient = new CollaborationClient(roomId, WS_URL, activeParticipant, {
        onRoomState: (nextSnapshot) => {
          startTransition(() => {
            setSnapshot(nextSnapshot);
            setParticipants(nextSnapshot.participants);
            setSuggestions(nextSnapshot.suggestions);
            setEvents(nextSnapshot.events);
            setTerminal(nextSnapshot.terminal);
          });
        },
        onEvent: (event) => {
          setEvents((currentEvents) => [event, ...currentEvents].slice(0, 40));
        },
        onAiSuggestions: (nextSuggestions) => {
          setSuggestions(nextSuggestions);
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

  const statusTone = useMemo(() => {
    if (terminal.status === "running") {
      return "text-amber-300";
    }

    if (terminal.status === "success") {
      return "text-emerald-300";
    }

    if (terminal.status === "error" || terminal.status === "timeout") {
      return "text-rose-300";
    }

    return "text-slate-300";
  }, [terminal.status]);

  const participantLabel = participant ? participant.name : "Готовим профиль...";

  return (
    <main className="min-h-screen px-4 py-5 text-slate-100 lg:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-panel/80 p-4 shadow-panel backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/" className="text-xs uppercase tracking-[0.3em] text-accent">
              CollabCode AI
            </Link>
            <h1 className="mt-2 text-2xl font-semibold">Комната {roomId}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-border px-3 py-2 text-sm text-muted">
              {connected ? "WebSocket online" : "Подключение..."}
            </div>
            <div className="rounded-full border border-border px-3 py-2 text-sm">
              Вы:{" "}
              <span style={{ color: participant?.color ?? "#39d0a0" }}>{participantLabel}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextIdentity = rotateLocalIdentity();
                if (nextIdentity) {
                  setParticipant(nextIdentity);
                }
              }}
              className="rounded-full border border-border px-4 py-2 text-sm text-slate-100 transition hover:border-accent hover:text-accent"
            >
              Сменить пользователя
            </button>
            <button
              type="button"
              disabled={!client || !snapshot}
              onClick={() => {
                if (!client) {
                  return;
                }

                client.runCode({
                  roomId,
                  language: "python",
                  code: client.doc.getText("monaco").toString(),
                });
              }}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-glow disabled:cursor-not-allowed disabled:opacity-60"
            >
              Run Python
            </button>
          </div>
        </header>

        {errorMessage ? (
          <section className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {errorMessage}
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-h-[78vh] gap-4 xl:grid-rows-[minmax(0,1fr)_220px]">
            <div className="flex min-h-[0] flex-col overflow-hidden rounded-3xl border border-border bg-panel/80 shadow-panel">
              <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm text-muted">
                <span>{snapshot?.fileName ?? "main.py"}</span>
                <span>{snapshot?.language ?? DEFAULT_LANGUAGE}</span>
              </div>
              <div className="min-h-[420px] flex-1">
                {client ? (
                  <EditorPane
                    doc={client.doc}
                    awareness={client.awareness}
                    language={snapshot?.language ?? DEFAULT_LANGUAGE}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted">
                    Загружаем редактор и состояние комнаты...
                  </div>
                )}
              </div>
            </div>

            <section className="rounded-3xl border border-border bg-panel/80 p-4 shadow-panel">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  Shared Terminal
                </h2>
                <span className={clsx("text-xs font-medium", statusTone)}>{terminal.status}</span>
              </div>
              <div className="mt-4 h-[150px] overflow-y-auto rounded-2xl border border-border/80 bg-[#050b13] p-3 font-mono text-xs">
                {terminal.lines.length > 0 ? (
                  terminal.lines.map((line) => (
                    <div
                      key={line.id}
                      className={clsx(
                        "mb-1 whitespace-pre-wrap",
                        line.stream === "stderr" && "text-rose-300",
                        line.stream === "stdout" && "text-emerald-300",
                        line.stream === "system" && "text-sky-300",
                      )}
                    >
                      {line.text}
                    </div>
                  ))
                ) : (
                  <div className="text-muted">
                    Здесь появится общий вывод запуска кода.
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="grid gap-4 xl:grid-rows-[auto_auto_1fr]">
            <section className="rounded-3xl border border-border bg-panel/80 p-4 shadow-panel">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  Участники
                </h2>
                <span className="text-xs text-muted">{participants.length} в списке</span>
              </div>
              <div className="mt-4 space-y-3">
                {participants.length > 0 ? (
                  participants.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between rounded-2xl border border-border/80 bg-ink/40 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold text-ink"
                          style={{ backgroundColor: member.color }}
                        >
                          {member.avatar}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{member.name}</div>
                          <div className="text-xs text-muted">
                            {member.status === "online" ? "online" : "offline"}
                          </div>
                        </div>
                      </div>
                      <span
                        className={clsx(
                          "h-2.5 w-2.5 rounded-full",
                          member.status === "online" ? "bg-emerald-400" : "bg-slate-500",
                        )}
                      />
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted">
                    Пока никого нет.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-panel/80 p-4 shadow-panel">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  AI Review
                </h2>
                <span className="text-xs text-muted">{suggestions.length} подсказки</span>
              </div>
              <div className="mt-4 space-y-3">
                {suggestions.length > 0 ? (
                  suggestions.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-border/80 bg-ink/45 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold">{item.title}</h3>
                        <span
                          className={clsx(
                            "rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.15em]",
                            item.severity === "high" && "bg-rose-500/20 text-rose-200",
                            item.severity === "medium" && "bg-amber-500/20 text-amber-200",
                            item.severity === "low" && "bg-sky-500/20 text-sky-200",
                          )}
                        >
                          {item.severity}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-200">{item.explanation}</p>
                      <p className="mt-2 text-xs text-muted">{item.suggestedFix}</p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted">
                    AI review появится после первых изменений.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-panel/80 p-4 shadow-panel">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  Event Feed
                </h2>
                <span className="text-xs text-muted">Live</span>
              </div>
              <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1">
                {events.length > 0 ? (
                  events.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-border/80 bg-ink/40 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] text-accent">
                        {item.type}
                      </div>
                      <div className="mt-1 text-sm text-slate-100">{item.message}</div>
                      <div className="mt-2 text-xs text-muted">
                        {new Date(item.createdAt).toLocaleTimeString("ru-RU")}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted">
                    Лента событий появится по мере работы в комнате.
                  </div>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
