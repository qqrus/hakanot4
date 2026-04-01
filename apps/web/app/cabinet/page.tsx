"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Pause, Play, UserRound } from "lucide-react";
import clsx from "clsx";

import {
  clearToken,
  createRoom,
  getMe,
  getMyRooms,
  getRoomMembers,
  joinRoomWithCode,
  setAnonymousMode,
  setMemberRole,
  type AuthUser,
  type PlatformRoom,
  type PlatformRoomMember,
  startRoom,
  stopRoom,
  updateGoal,
} from "../../lib/platform-api";

export default function CabinetPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [rooms, setRooms] = useState<PlatformRoom[]>([]);
  const [membersByRoom, setMembersByRoom] = useState<Record<string, PlatformRoomMember[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updatingRoleKey, setUpdatingRoleKey] = useState<string | null>(null);
  const [updatingAnonymousRoomId, setUpdatingAnonymousRoomId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [visibility, setVisibility] = useState<"open" | "closed">("open");
  const [accessCode, setAccessCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const load = async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [me, myRooms] = await Promise.all([getMe(), getMyRooms()]);
      const membersEntries = await Promise.all(
        myRooms.map(async (room) => [room.id, await getRoomMembers(room.id)] as const),
      );
      const nextMembersByRoom: Record<string, PlatformRoomMember[]> = {};
      for (const [roomId, members] of membersEntries) {
        nextMembersByRoom[roomId] = members;
      }

      setUser(me);
      setRooms(myRooms);
      setMembersByRoom(nextMembersByRoom);
    } catch (error) {
      clearToken();
      router.push("/auth");
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить кабинет.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitCreate = async (): Promise<void> => {
    setIsCreating(true);
    setErrorMessage(null);
    try {
      await createRoom({
        title,
        goal,
        visibility,
        accessCode: visibility === "closed" ? accessCode : undefined,
      });
      setTitle("");
      setGoal("");
      setAccessCode("");
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось создать комнату.");
    } finally {
      setIsCreating(false);
    }
  };

  const toggleRuntime = async (room: PlatformRoom): Promise<void> => {
    try {
      if (room.runtime?.status === "running") {
        await stopRoom(room.id);
      } else {
        await startRoom(room.id);
      }
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось изменить статус runtime.");
    }
  };

  const applyGoal = async (roomId: string, nextGoal: string): Promise<void> => {
    try {
      await updateGoal(roomId, nextGoal);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось обновить цель комнаты.");
    }
  };

  const applyMemberRole = async (
    roomId: string,
    targetUserId: string,
    role: "editor" | "viewer",
  ): Promise<void> => {
    const key = `${roomId}:${targetUserId}`;
    setUpdatingRoleKey(key);
    setErrorMessage(null);
    try {
      await setMemberRole(roomId, targetUserId, role);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось изменить роль участника.");
    } finally {
      setUpdatingRoleKey(null);
    }
  };

  const toggleAnonymous = async (roomId: string, nextValue: boolean): Promise<void> => {
    setUpdatingAnonymousRoomId(roomId);
    setErrorMessage(null);
    try {
      await setAnonymousMode(roomId, nextValue);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось изменить режим инкогнито.");
    } finally {
      setUpdatingAnonymousRoomId(null);
    }
  };

  const submitJoin = async (): Promise<void> => {
    setIsJoining(true);
    setErrorMessage(null);
    try {
      const targetRoomId = joinRoomId.trim();
      await joinRoomWithCode(targetRoomId, joinCode.trim() || undefined);
      router.push(`/room/${encodeURIComponent(targetRoomId)}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось войти в комнату.");
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen px-4 py-8 lg:px-8">
        <div className="mx-auto max-w-[1200px] rounded-[28px] border border-white/80 bg-white/70 p-6 text-sm font-semibold text-slate-500 shadow-panel">
          Загружаем кабинет...
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute -right-20 top-14 h-72 w-72 rounded-full bg-primary/20 blur-[140px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1200px] space-y-5">
        <section className="rounded-[28px] border border-white/80 bg-white/70 p-6 shadow-panel backdrop-blur-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Личный кабинет</p>
              <h1 className="mt-2 text-3xl font-black text-ink">Управление комнатами</h1>
              <p className="mt-2 text-sm text-slate-500">
                {user ? `${user.name} · ${user.email}` : "Пользователь"}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700">
                Главная
              </Link>
              <button
                type="button"
                onClick={() => {
                  clearToken();
                  router.push("/auth");
                }}
                className="rounded-full bg-ink px-4 py-2 text-xs font-black uppercase tracking-wide text-white"
              >
                Выйти
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_1.95fr]">
          <article className="rounded-[28px] border border-white/80 bg-white/70 p-5 shadow-panel backdrop-blur-2xl">
            <h2 className="text-lg font-black text-ink">Создать комнату</h2>
            <p className="mt-1 text-sm text-slate-500">Цель комнаты помогает ИИ давать релевантные подсказки.</p>

            <div className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Название комнаты"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-accent"
              />
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Цель комнаты (например: разработать устойчивый алгоритм сортировки)"
                rows={4}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-accent"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility("open")}
                  className={clsx("rounded-xl px-3 py-2 text-sm font-bold", visibility === "open" ? "bg-ink text-white" : "bg-white text-slate-500 border border-slate-200")}
                >
                  Открытая
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("closed")}
                  className={clsx("rounded-xl px-3 py-2 text-sm font-bold", visibility === "closed" ? "bg-ink text-white" : "bg-white text-slate-500 border border-slate-200")}
                >
                  Закрытая
                </button>
              </div>
              {visibility === "closed" && (
                <input
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="Код доступа"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-accent"
                />
              )}
              <button
                type="button"
                onClick={() => void submitCreate()}
                disabled={isCreating}
                className="w-full rounded-2xl bg-gradient-to-r from-accent to-primary px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow-neon-pink disabled:opacity-50"
              >
                {isCreating ? "Создаем..." : "Создать комнату"}
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200/70 bg-white/85 p-4">
              <h3 className="text-sm font-black text-ink">Войти по ID комнаты</h3>
              <p className="mt-1 text-xs text-slate-500">Для закрытых комнат укажите код доступа.</p>
              <div className="mt-3 space-y-2">
                <input
                  value={joinRoomId}
                  onChange={(event) => setJoinRoomId(event.target.value)}
                  placeholder="room_xxxxxxxx"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-accent"
                />
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Код доступа (если нужен)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={isJoining || !joinRoomId.trim()}
                  onClick={() => void submitJoin()}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-700 disabled:opacity-50"
                >
                  {isJoining ? "Входим..." : "Войти по ID"}
                </button>
              </div>
            </div>
          </article>

          <article className="rounded-[28px] border border-white/80 bg-white/70 p-5 shadow-panel backdrop-blur-2xl">
            <h2 className="text-lg font-black text-ink">Мои комнаты</h2>
            <p className="mt-1 text-sm text-slate-500">Владелец управляет runtime, целями и ролями участников.</p>

            <div className="mt-4 space-y-3">
              {rooms.map((room, index) => {
                const roomMembers = membersByRoom[room.id] ?? [];
                const selfMember = roomMembers.find((member) => member.userId === user?.id);
                const isAnonymous = selfMember?.isAnonymous ?? room.isAnonymous;

                return (
                  <motion.div
                    key={room.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.2) }}
                    className="rounded-2xl border border-slate-200/80 bg-white/90 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-black text-ink">{room.title}</h3>
                        <p className="mt-1 text-xs text-slate-500">{room.id}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                          {room.visibility === "open" ? "Открытая" : "Закрытая"}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                          {room.role}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 inline-flex items-center gap-1">
                          <UserRound size={12} />
                          {room.onlineCount}/8 онлайн
                        </span>
                      </div>
                    </div>

                    <textarea
                      defaultValue={room.goal}
                      rows={2}
                      readOnly={room.role !== "owner"}
                      className={clsx(
                        "mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none",
                        room.role === "owner"
                          ? "bg-slate-50 text-slate-700 focus:border-accent"
                          : "bg-slate-100 text-slate-500 cursor-not-allowed",
                      )}
                      onBlur={(event) => {
                        if (room.role !== "owner") {
                          return;
                        }
                        const nextGoal = event.target.value.trim();
                        if (nextGoal && nextGoal !== room.goal) {
                          void applyGoal(room.id, nextGoal);
                        }
                      }}
                    />

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">
                        Runtime: {room.runtime?.status ?? "stopped"} {room.runtime?.volumeName ? `· ${room.runtime.volumeName}` : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleAnonymous(room.id, !isAnonymous)}
                          disabled={updatingAnonymousRoomId === room.id}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 disabled:opacity-50"
                        >
                          {isAnonymous ? "Инкогнито: вкл" : "Инкогнито: выкл"}
                        </button>
                        {room.role === "owner" && (
                          <button
                            type="button"
                            onClick={() => void toggleRuntime(room)}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700"
                          >
                            {room.runtime?.status === "running" ? <Pause size={12} /> : <Play size={12} />}
                            {room.runtime?.status === "running" ? "Остановить" : "Запустить"}
                          </button>
                        )}
                        <Link
                          href={`/room/${room.id}`}
                          className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white"
                        >
                          Войти <ArrowUpRight size={12} />
                        </Link>
                      </div>
                    </div>

                    {room.role === "owner" && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">
                          Участники и роли
                        </p>
                        <div className="mt-2 space-y-2">
                          {roomMembers.map((member) => {
                            const itemKey = `${room.id}:${member.userId}`;
                            return (
                              <div key={itemKey} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <div>
                                  <p className="text-sm font-semibold text-slate-700">
                                    {member.name} {member.userId === user?.id ? "(вы)" : ""}
                                  </p>
                                  <p className="text-xs text-slate-500">{member.email}</p>
                                </div>
                                {member.role === "owner" ? (
                                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                                    owner
                                  </span>
                                ) : (
                                  <select
                                    value={member.role}
                                    disabled={updatingRoleKey === itemKey}
                                    onChange={(event) =>
                                      void applyMemberRole(
                                        room.id,
                                        member.userId,
                                        event.target.value as "editor" | "viewer",
                                      )
                                    }
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                                  >
                                    <option value="editor">editor</option>
                                    <option value="viewer">viewer</option>
                                  </select>
                                )}
                              </div>
                            );
                          })}
                          {roomMembers.length === 0 && (
                            <p className="text-xs text-slate-500">Участники пока не подключались.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
              {rooms.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-5 text-sm font-medium text-slate-500">
                  Пока нет комнат. Создайте первую в левой колонке.
                </div>
              )}
            </div>
          </article>
        </section>

        {errorMessage && (
          <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
            {errorMessage}
          </div>
        )}
      </div>
    </main>
  );
}
