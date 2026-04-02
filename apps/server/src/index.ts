import http from "node:http";

import { DEMO_ROOM_ID, type ClientMessage, type Participant, type ServerMessage } from "@collabcode/shared";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

import { env } from "./config/env.js";
import { createAuthToken, verifyAuthToken } from "./lib/auth-token.js";
import { createId } from "./lib/id.js";
import { getAiProviderStatus, getNavigatorAdvice } from "./services/ai-service.js";
import {
  channelsConfigured,
  getChannelConfigFromEnv,
  getIntegrationStatus,
  notifyChannels,
  notifyChannelsDetailed,
  type NotificationChannelConfig,
} from "./services/notification-service.js";
import {
  addXpEvent,
  awardAchievementIfMissing,
  createRoomForOwner,
  createUser,
  ensurePlatformSchema,
  findUserByEmail,
  getGamificationSummary,
  getLeaderboard,
  getMembership,
  getRoomById,
  getRoomIntegrationsByRoom,
  getRoomIntegrationsForUser,
  getRoomRuntime,
  getUserById,
  joinRoom,
  listRoomMembers,
  listRunningRoomRuntimes,
  listRoomsForUser,
  markRoomRuntimeWarning,
  setAnonymousMode,
  setRoomRuntimeStatus,
  setRoomRuntimeStatusSystem,
  touchRoomRuntimeActivity,
  updateMemberRole,
  updateRoomIntegrations,
  updateRoomGoal,
  validatePassword,
} from "./services/platform-store.js";
import { ensureRoomRuntimeArtifacts, inspectRoomContainerStatus, startRoomContainer, stopRoomContainer } from "./services/room-orchestrator.js";
import { roomStore } from "./services/room-store.js";
import { runPythonInSandbox } from "./services/sandbox-runner.js";

type SocketRole = "owner" | "editor" | "viewer" | "demo";
type SocketMeta = { roomId: string; participantId: string; userId: string | null; role: SocketRole };

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_request, response) => response.json({ status: "ok" }));

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(2).max(60) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const createRoomSchema = z.object({ title: z.string().min(2).max(120), goal: z.string().min(3).max(500), visibility: z.enum(["open", "closed"]), accessCode: z.string().min(4).max(64).optional() });
const joinRoomSchema = z.object({ accessCode: z.string().min(4).max(64).optional() });
const goalSchema = z.object({ goal: z.string().min(3).max(500) });
const roleSchema = z.object({ targetUserId: z.string().min(3), role: z.enum(["editor", "viewer"]) });
const anonymousSchema = z.object({ isAnonymous: z.boolean() });
const navigatorSchema = z.object({ question: z.string().min(3).max(500) });
const roomIntegrationsSchema = z.object({
  telegramChatId: z.string().trim().max(64).nullable().optional(),
  discordWebhookUrl: z.string().trim().url().max(500).nullable().optional(),
  discordNickname: z.string().trim().max(80).nullable().optional(),
});

interface AuthenticatedRequest extends express.Request {
  auth?: { userId: string; email: string };
}

async function getRoomNotificationConfig(roomId: string): Promise<NotificationChannelConfig> {
  const roomIntegrations = await getRoomIntegrationsByRoom(roomId);
  const envConfig = getChannelConfigFromEnv();
  return {
    telegramBotToken: envConfig.telegramBotToken,
    telegramChatId: roomIntegrations.telegramChatId,
    discordWebhookUrl: roomIntegrations.discordWebhookUrl,
    discordNickname: roomIntegrations.discordNickname,
  };
}

function requireAuth(request: AuthenticatedRequest, response: express.Response, next: express.NextFunction): void {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    response.status(401).json({ message: "Требуется авторизация." });
    return;
  }
  const payload = verifyAuthToken(token);
  if (!payload) {
    response.status(401).json({ message: "Сессия недействительна." });
    return;
  }
  request.auth = payload;
  next();
}

app.post("/api/auth/register", async (request, response) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректные данные регистрации." });
    return;
  }
  try {
    const exists = await findUserByEmail(parsed.data.email);
    if (exists) {
      response.status(409).json({ message: "Пользователь с таким email уже существует." });
      return;
    }
    const user = await createUser(parsed.data);
    const token = createAuthToken({ userId: user.id, email: user.email });
    response.status(201).json({ token, user });
  } catch (error) {
    console.error("register failed:", error);
    response.status(500).json({ message: "Не удалось зарегистрировать пользователя." });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректные данные входа." });
    return;
  }
  try {
    const user = await findUserByEmail(parsed.data.email);
    if (!user || !validatePassword(parsed.data.password, user.passwordHash)) {
      response.status(401).json({ message: "Неверный email или пароль." });
      return;
    }
    const token = createAuthToken({ userId: user.id, email: user.email });
    response.json({ token, user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, createdAt: user.createdAt } });
  } catch (error) {
    console.error("login failed:", error);
    response.status(500).json({ message: "Не удалось выполнить вход." });
  }
});

app.get("/api/auth/me", requireAuth, async (request: AuthenticatedRequest, response) => {
  const user = await getUserById(request.auth!.userId);
  if (!user) {
    response.status(404).json({ message: "Пользователь не найден." });
    return;
  }
  response.json(user);
});

app.get("/api/platform/rooms/my", requireAuth, async (request: AuthenticatedRequest, response) => {
  try {
    const rooms = await listRoomsForUser(request.auth!.userId);
    const roomsWithLiveOnline = rooms.map((room) => {
      const snapshot = roomStore.getSnapshot(room.id);
      const onlineCount = snapshot.participants.filter((participant) => participant.status === "online").length;
      return { ...room, onlineCount };
    });
    response.json({ rooms: roomsWithLiveOnline });
  } catch (error) {
    console.error("list rooms failed:", error);
    response.status(500).json({ message: "Не удалось загрузить комнаты." });
  }
});

app.post("/api/platform/rooms", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = createRoomSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректные параметры комнаты." });
    return;
  }
  if (parsed.data.visibility === "closed" && !parsed.data.accessCode) {
    response.status(400).json({ message: "Для закрытой комнаты нужен код доступа." });
    return;
  }
  try {
    const room = await createRoomForOwner({
      ownerId: request.auth!.userId,
      title: parsed.data.title,
      goal: parsed.data.goal,
      visibility: parsed.data.visibility,
      accessCode: parsed.data.accessCode,
    });
    response.status(201).json({ room });
  } catch (error) {
    console.error("create room failed:", error);
    response.status(500).json({ message: "Не удалось создать комнату." });
  }
});

app.post("/api/platform/rooms/:roomId/join", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = joinRoomSchema.safeParse(request.body ?? {});
  const roomId = String(request.params.roomId ?? "");
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректные параметры входа." });
    return;
  }
  try {
    const membership = await joinRoom({
      roomId,
      userId: request.auth!.userId,
      accessCode: parsed.data.accessCode,
    });
    response.json({ membership });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Не удалось войти в комнату." });
  }
});

app.patch("/api/platform/rooms/:roomId/goal", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = goalSchema.safeParse(request.body);
  const roomId = String(request.params.roomId ?? "");
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректная цель комнаты." });
    return;
  }
  try {
    const room = await updateRoomGoal({
      roomId,
      ownerId: request.auth!.userId,
      goal: parsed.data.goal,
    });
    response.json({ room });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось обновить цель." });
  }
});

app.post("/api/platform/rooms/:roomId/role", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = roleSchema.safeParse(request.body);
  const roomId = String(request.params.roomId ?? "");
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректные данные роли." });
    return;
  }
  try {
    const membership = await updateMemberRole({
      roomId,
      ownerId: request.auth!.userId,
      targetUserId: parsed.data.targetUserId,
      role: parsed.data.role,
    });
    response.json({ membership });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось изменить роль." });
  }
});

app.post("/api/platform/rooms/:roomId/anonymous", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = anonymousSchema.safeParse(request.body);
  const roomId = String(request.params.roomId ?? "");
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректный флаг инкогнито." });
    return;
  }
  try {
    const membership = await setAnonymousMode({
      roomId,
      userId: request.auth!.userId,
      isAnonymous: parsed.data.isAnonymous,
    });
    response.json({ membership });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Не удалось изменить режим инкогнито." });
  }
});

app.post("/api/platform/rooms/:roomId/runtime/start", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const runtimeMeta = await setRoomRuntimeStatus({
      roomId,
      ownerId: request.auth!.userId,
      status: "starting",
    });

    await ensureRoomRuntimeArtifacts({
      containerId: runtimeMeta.containerId,
      volumeName: runtimeMeta.volumeName,
    });
    await startRoomContainer(runtimeMeta.containerId);

    const runtime = await setRoomRuntimeStatusSystem({ roomId, status: "running" });
    void (async () => {
      const config = await getRoomNotificationConfig(roomId);
      await notifyChannels(`🚀 Комната ${roomId}: runtime запущен.`, config);
    })().catch(() => undefined);
    response.json({ runtime });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось запустить комнату." });
  }
});

app.post("/api/platform/rooms/:roomId/runtime/stop", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const runtimeMeta = await setRoomRuntimeStatus({
      roomId,
      ownerId: request.auth!.userId,
      status: "stopping",
    });
    await stopRoomContainer(runtimeMeta.containerId);
    const runtime = await setRoomRuntimeStatusSystem({ roomId, status: "stopped" });
    void (async () => {
      const config = await getRoomNotificationConfig(roomId);
      await notifyChannels(`🛑 Комната ${roomId}: runtime остановлен.`, config);
    })().catch(() => undefined);
    response.json({ runtime });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось остановить комнату." });
  }
});

app.get("/api/platform/rooms/:roomId/runtime/status", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const membership = await getMembership(roomId, request.auth!.userId);
    if (!membership) {
      response.status(403).json({ message: "Нет доступа к runtime этой комнаты." });
      return;
    }
    const runtime = await getRoomRuntime(roomId);
    if (!runtime) {
      response.json({ runtime: null });
      return;
    }

    const dockerState = await inspectRoomContainerStatus(runtime.containerId);
    if (dockerState === "running" && runtime.status !== "running") {
      response.json({ runtime: await setRoomRuntimeStatusSystem({ roomId, status: "running" }) });
      return;
    }
    if ((dockerState === "exited" || dockerState === "created" || dockerState === "not_found") && runtime.status !== "stopped") {
      response.json({ runtime: await setRoomRuntimeStatusSystem({ roomId, status: "stopped" }) });
      return;
    }
    response.json({ runtime });
  } catch (error) {
    console.error("runtime status failed:", error);
    response.status(500).json({ message: "Не удалось получить статус runtime." });
  }
});

app.get("/api/platform/rooms/:roomId/meta", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const membership = await getMembership(roomId, request.auth!.userId);
    if (!membership) {
      response.status(403).json({ message: "Нет доступа к комнате." });
      return;
    }
    const room = await getRoomById(roomId);
    if (!room) {
      response.status(404).json({ message: "Комната не найдена." });
      return;
    }
    response.json({
      room: {
        id: room.id,
        ownerId: room.ownerId,
        title: room.title,
        goal: room.goal,
        visibility: room.visibility,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
      },
      membership,
    });
  } catch (error) {
    console.error("room meta failed:", error);
    response.status(500).json({ message: "Не удалось получить метаданные комнаты." });
  }
});

app.get("/api/platform/rooms/:roomId/members", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const members = await listRoomMembers(roomId, request.auth!.userId);
    response.json({ members });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось получить участников комнаты." });
  }
});

app.get("/api/platform/rooms/:roomId/integrations", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const integrations = await getRoomIntegrationsForUser({
      roomId,
      userId: request.auth!.userId,
    });
    response.json({ integrations });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось получить интеграции комнаты." });
  }
});

app.patch("/api/platform/rooms/:roomId/integrations", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  const parsed = roomIntegrationsSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректные параметры интеграций комнаты." });
    return;
  }
  try {
    const integrations = await updateRoomIntegrations({
      roomId,
      ownerId: request.auth!.userId,
      telegramChatId: parsed.data.telegramChatId ?? null,
      discordWebhookUrl: parsed.data.discordWebhookUrl ?? null,
      discordNickname: parsed.data.discordNickname ?? null,
    });
    response.json({ integrations });
  } catch (error) {
    response.status(403).json({ message: error instanceof Error ? error.message : "Не удалось обновить интеграции комнаты." });
  }
});

app.post("/api/platform/rooms/:roomId/integrations/test", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  try {
    const membership = await getMembership(roomId, request.auth!.userId);
    if (!membership) {
      response.status(403).json({ message: "Нет доступа к этой комнате." });
      return;
    }
    const config = await getRoomNotificationConfig(roomId);
    const integrations = getIntegrationStatus(config);
    if (!channelsConfigured(config)) {
      response.status(400).json({ message: "Интеграции этой комнаты не настроены.", integrations });
      return;
    }
    const delivery = await notifyChannelsDetailed(
      `✅ Тест уведомлений комнаты ${roomId} от ${request.auth!.email}`,
      config,
    );
    response.json({ ok: delivery.errors.length === 0, integrations, delivery });
  } catch (error) {
    response.status(500).json({ message: error instanceof Error ? error.message : "Не удалось отправить тест комнаты." });
  }
});

app.get("/api/platform/leaderboard", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = typeof request.query.roomId === "string" ? request.query.roomId : undefined;
  const limitRaw = typeof request.query.limit === "string" ? Number.parseInt(request.query.limit, 10) : undefined;
  try {
    if (roomId) {
      const membership = await getMembership(roomId, request.auth!.userId);
      if (!membership) {
        response.status(403).json({ message: "Нет доступа к лидерборду этой комнаты." });
        return;
      }
    }
    const leaderboard = await getLeaderboard({ roomId, limit: limitRaw });
    response.json({ leaderboard });
  } catch (error) {
    response.status(500).json({ message: error instanceof Error ? error.message : "Не удалось загрузить лидерборд." });
  }
});

app.get("/api/platform/gamification/summary", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = typeof request.query.roomId === "string" ? request.query.roomId : undefined;
  try {
    if (roomId) {
      const membership = await getMembership(roomId, request.auth!.userId);
      if (!membership) {
        response.status(403).json({ message: "Нет доступа к комнате для получения геймификации." });
        return;
      }
    }
    const summary = await getGamificationSummary({ userId: request.auth!.userId, roomId });
    response.json({ summary });
  } catch (error) {
    console.error("gamification summary failed:", error);
    response.status(500).json({ message: "Не удалось получить сводку геймификации." });
  }
});

app.post("/api/platform/rooms/:roomId/navigator", requireAuth, async (request: AuthenticatedRequest, response) => {
  const roomId = String(request.params.roomId ?? "");
  const parsed = navigatorSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Некорректный запрос к AI-навигатору." });
    return;
  }
  const room = await getRoomById(roomId);
  if (!room) {
    response.status(404).json({ message: "Комната не найдена." });
    return;
  }
  let membership = await getMembership(roomId, request.auth!.userId);
  if (!membership && room.visibility === "open") {
    membership = await joinRoom({
      roomId,
      userId: request.auth!.userId,
    });
  }
  if (!membership) {
    response.status(403).json({ message: "Нет доступа к этой комнате." });
    return;
  }

  const context = roomStore.getRecentContext(roomId);
  const result = await getNavigatorAdvice({
    roomId,
    goal: room.goal,
    code: context.code,
    recentEvents: context.recentEvents,
    recentSuggestions: context.recentSuggestions,
    question: parsed.data.question,
  });
  response.json(result);
});

app.get("/api/platform/ai/status", requireAuth, (_request: AuthenticatedRequest, response) => {
  response.json({ ai: getAiProviderStatus() });
});

app.get("/api/platform/integrations/status", requireAuth, (_request: AuthenticatedRequest, response) => {
  response.json({ integrations: getIntegrationStatus() });
});

app.post("/api/platform/integrations/test", requireAuth, async (request: AuthenticatedRequest, response) => {
  const integrations = getIntegrationStatus();
  if (!channelsConfigured()) {
    response.status(400).json({ message: "Интеграции не настроены.", integrations });
    return;
  }
  const delivery = await notifyChannelsDetailed(`✅ Тест уведомлений CollabCode от ${request.auth!.email}`);
  response.json({ ok: delivery.errors.length === 0, integrations, delivery });
});

app.get("/api/rooms/:roomId", (request, response) => {
  const snapshot = roomStore.getSnapshot(request.params.roomId);
  response.json(snapshot);
});

app.get("/api/home/:roomId", (request, response) => {
  const snapshot = roomStore.getSnapshot(request.params.roomId);
  const now = Date.now();
  const participantById = new Map(snapshot.participants.map((item) => [item.id, item.name]));
  const onlineParticipants = snapshot.participants.filter((participant) => participant.status === "online").length;
  const totalParticipants = snapshot.participants.length;

  const suggestionSeverity = snapshot.suggestions.reduce(
    (acc, item) => {
      acc[item.severity] = (acc[item.severity] ?? 0) + 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );

  const trend = Array.from({ length: 12 }, () => 0);
  for (const event of snapshot.events.filter((item) => item.type === "edit")) {
    const createdAt = new Date(event.createdAt).getTime();
    if (Number.isNaN(createdAt)) continue;
    const diffMinutes = (now - createdAt) / 60000;
    if (diffMinutes < 0 || diffMinutes >= 60) continue;
    const bin = 11 - Math.floor(diffMinutes / 5);
    if (bin >= 0 && bin < trend.length) trend[bin] = (trend[bin] ?? 0) + 1;
  }
  const editsLastHour = trend.reduce((sum, value) => sum + value, 0);
  const throughputPerMinute = Number((editsLastHour / 60).toFixed(2));

  const recentEvents = snapshot.events.slice(0, 10).map((event) => ({
    id: event.id,
    type: event.type,
    typeLabel:
      event.type === "join" ? "Подключение" :
      event.type === "leave" ? "Выход" :
      event.type === "edit" ? "Правка" :
      event.type === "run" ? "Запуск" :
      event.type === "ai" ? "ИИ-ревью" :
      event.type === "achievement" ? "Достижение" :
      event.type === "rank-up" ? "Повышение" : "Система",
    message: event.message,
    actorName: event.participantId ? participantById.get(event.participantId) ?? null : null,
    createdAt: event.createdAt,
    risk:
      event.type === "ai" && suggestionSeverity.high > 0 ? "high" :
      event.type === "ai" && suggestionSeverity.medium > 0 ? "medium" :
      event.type === "run" && (snapshot.terminal.status === "error" || snapshot.terminal.status === "timeout") ? "high" :
      event.type === "system" ? "medium" : "low",
    status:
      event.type === "run" ? snapshot.terminal.status :
      event.type === "ai" && suggestionSeverity.high > 0 ? "attention" : "ok",
  }));

  response.json({
    roomId: snapshot.roomId,
    participants: { online: onlineParticipants, total: totalParticipants },
    ai: {
      suggestions: snapshot.suggestions.length,
      severity: suggestionSeverity,
      source: snapshot.ai.source,
      status: snapshot.ai.status,
      statusMessage: snapshot.ai.message,
      reactionMs: null,
      scores: { security: 80, complexity: 78, readability: 85, performance: snapshot.terminal.status === "success" ? 90 : 74 },
    },
    execution: { status: snapshot.terminal.status },
    trend,
    throughputPerMinute,
    syncRate: totalParticipants > 0 ? Math.round((onlineParticipants / totalParticipants) * 100) : 100,
    model: "arcee-ai/trinity-large-preview",
    core: {
      collaborationIndex: totalParticipants > 0 ? onlineParticipants / totalParticipants : 0,
      suggestionLoad: Math.min(1, snapshot.suggestions.length / 6),
      stabilityIndex: 0.8,
    },
    recentEvents,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const socketRooms = new Map<WebSocket, SocketMeta>();

function canEdit(role: SocketRole): boolean {
  return role === "owner" || role === "editor" || role === "demo";
}

function canRun(role: SocketRole): boolean {
  return role === "owner" || role === "editor" || role === "demo";
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function broadcast(roomId: string, message: ServerMessage, exceptParticipantId?: string): void {
  for (const [socket, metadata] of socketRooms.entries()) {
    if (metadata.roomId !== roomId) continue;
    if (exceptParticipantId && metadata.participantId === exceptParticipantId) continue;
    send(socket, message);
  }
}

function touchRuntime(roomId: string): void {
  void touchRoomRuntimeActivity(roomId).catch(() => undefined);
}

async function awardRoomAchievements(input: {
  roomId: string;
  userId: string;
  trigger: "edit" | "run-success";
}): Promise<void> {
  const summary = await getGamificationSummary({ userId: input.userId, roomId: input.roomId });
  const achievementMessages: string[] = [];

  const milestoneChecks: Array<{
    when: boolean;
    code: string;
    title: string;
    description: string;
  }> = [
    {
      when: summary.eventsCount >= 1,
      code: "first_steps",
      title: "Первые шаги",
      description: "Совершено первое действие в комнате.",
    },
    {
      when: summary.totalXp >= 500,
      code: "steady_contributor",
      title: "Стабильный участник",
      description: "Накоплено 500 XP в комнате.",
    },
    {
      when: summary.totalXp >= 2000,
      code: "team_engine",
      title: "Двигатель команды",
      description: "Накоплено 2000 XP в комнате.",
    },
    {
      when: input.trigger === "run-success",
      code: "green_run",
      title: "Зеленый прогон",
      description: "Код выполнен успешно без ошибки.",
    },
  ];

  for (const check of milestoneChecks) {
    if (!check.when) {
      continue;
    }
    const result = await awardAchievementIfMissing({
      userId: input.userId,
      roomId: input.roomId,
      code: check.code,
      title: check.title,
      description: check.description,
    });
    if (result.created) {
      achievementMessages.push(`Достижение разблокировано: ${check.title}`);
    }
  }

  for (const message of achievementMessages) {
    const event = roomStore.pushSystemEvent(input.roomId, message);
    broadcast(input.roomId, { type: "event", payload: event });
  }
}

let autoStopLock = false;
async function runRuntimeAutoStopSweep(): Promise<void> {
  if (autoStopLock) return;
  autoStopLock = true;
  try {
    const runtimes = await listRunningRoomRuntimes();
    const now = Date.now();
    for (const runtime of runtimes) {
      const lastActivityMs = runtime.lastActivityAt ? new Date(runtime.lastActivityAt).getTime() : now;
      const idleMs = now - lastActivityMs;
      if (idleMs >= 15 * 60 * 1000) {
        await stopRoomContainer(runtime.containerId);
        await setRoomRuntimeStatusSystem({ roomId: runtime.roomId, status: "stopped" });
        await markRoomRuntimeWarning(runtime.roomId, null);
        const event = roomStore.pushSystemEvent(runtime.roomId, "Комната автоматически остановлена после 15 минут простоя.");
        broadcast(runtime.roomId, { type: "event", payload: event });
        void (async () => {
          const config = await getRoomNotificationConfig(runtime.roomId);
          await notifyChannels(`⏱️ Комната ${runtime.roomId}: auto-stop после простоя.`, config);
        })().catch(() => undefined);
      } else if (idleMs >= 13 * 60 * 1000 && !runtime.warningSentAt) {
        await markRoomRuntimeWarning(runtime.roomId, new Date());
        const event = roomStore.pushSystemEvent(runtime.roomId, "Внимание: через 2 минуты без активности контейнер будет остановлен.");
        broadcast(runtime.roomId, { type: "event", payload: event });
      }
    }
  } finally {
    autoStopLock = false;
  }
}

wss.on("connection", (socket) => {
  socket.on("message", async (rawMessage) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(rawMessage.toString()) as ClientMessage;
    } catch {
      send(socket, { type: "error", payload: { message: "Некорректный формат WebSocket-сообщения." } });
      return;
    }

    try {
      switch (message.type) {
        case "join-room": {
          const roomId = message.payload.roomId;
          const platformRoom = await getRoomById(roomId);
          let role: SocketRole = "demo";
          let userId: string | null = null;
          let name = message.payload.participant.name;
          let avatar = message.payload.participant.avatar;

          if (platformRoom) {
            const auth = message.payload.authToken ? verifyAuthToken(message.payload.authToken) : null;
            if (!auth) {
              send(socket, { type: "error", payload: { message: "Требуется авторизация для подключения к комнате." } });
              break;
            }
            let membership = await getMembership(roomId, auth.userId);
            if (!membership && platformRoom.visibility === "open") {
              membership = await joinRoom({
                roomId,
                userId: auth.userId,
              });
            }
            if (!membership) {
              send(socket, { type: "error", payload: { message: "У вас нет доступа к этой комнате." } });
              break;
            }
            const user = await getUserById(auth.userId);
            if (!user) {
              send(socket, { type: "error", payload: { message: "Пользователь не найден." } });
              break;
            }
            const runtime = await getRoomRuntime(roomId);
            if (!runtime || runtime.status !== "running") {
              send(socket, { type: "error", payload: { message: "Runtime комнаты не запущен." } });
              break;
            }
            role = membership.role;
            userId = auth.userId;
            name = membership.isAnonymous ? `Аноним-${user.avatar}` : user.name;
            avatar = user.avatar;
          } else if (roomId !== DEMO_ROOM_ID) {
            send(socket, { type: "error", payload: { message: "Комната не найдена." } });
            break;
          }

          const participantId = userId ?? message.payload.participant.id;
          const currentSnapshot = roomStore.getSnapshot(roomId);
          const onlineNow = currentSnapshot.participants.filter((item) => item.status === "online");
          const alreadyInRoom = onlineNow.some((item) => item.id === participantId);
          if (!alreadyInRoom && onlineNow.length >= 8) {
            send(socket, { type: "error", payload: { message: "Лимит комнаты: не более 8 онлайн-участников." } });
            break;
          }

          const participant: Participant = {
            ...message.payload.participant,
            id: participantId,
            name,
            avatar,
            status: "online",
            lastSeenAt: new Date().toISOString(),
          };
          socketRooms.set(socket, { roomId, participantId, userId, role });
          const { snapshot, event } = roomStore.joinRoom(roomId, participant);
          touchRuntime(roomId);
          send(socket, { type: "room-state", payload: snapshot });
          send(socket, { type: "doc-state", payload: { update: roomStore.getEncodedState(roomId) } });
          broadcast(roomId, { type: "participant-joined", payload: participant }, participant.id);
          broadcast(roomId, { type: "event", payload: event }, participant.id);
          break;
        }
        case "request-doc-state":
          send(socket, { type: "doc-state", payload: { update: roomStore.getEncodedState(message.payload.roomId) } });
          break;
        case "doc-update": {
          const meta = socketRooms.get(socket);
          if (!meta || meta.roomId !== message.payload.roomId) {
            send(socket, { type: "error", payload: { message: "Сначала подключитесь к комнате." } });
            break;
          }
          if (!canEdit(meta.role)) {
            send(socket, { type: "error", payload: { message: "Роль viewer не может редактировать код." } });
            break;
          }
          if (message.payload.actorId !== meta.participantId) {
            send(socket, { type: "error", payload: { message: "Неверный actorId." } });
            break;
          }
          const { event, updatedParticipant, xpDelta } = await roomStore.applyDocUpdate(
            message.payload.roomId,
            message.payload.actorId,
            message.payload.update,
            (state) => broadcast(message.payload.roomId, { type: "ai-status", payload: state }),
            (state, suggestions, aiEvent) => {
              broadcast(message.payload.roomId, { type: "ai-status", payload: state });
              broadcast(message.payload.roomId, { type: "ai-suggestions", payload: suggestions });
              if (aiEvent) broadcast(message.payload.roomId, { type: "event", payload: aiEvent });
              if (suggestions.some((item) => item.severity === "high")) {
                void (async () => {
                  const config = await getRoomNotificationConfig(message.payload.roomId);
                  await notifyChannels(`⚠️ Комната ${message.payload.roomId}: AI обнаружил критические замечания.`, config);
                })().catch(() => undefined);
              }
            },
          );
          if (xpDelta > 0 && meta.userId) {
            void addXpEvent({ roomId: message.payload.roomId, userId: meta.userId, points: xpDelta, eventType: "edit" }).catch(
              (error) => console.error("xp event insert failed:", error),
            );
            void awardRoomAchievements({
              roomId: message.payload.roomId,
              userId: meta.userId,
              trigger: "edit",
            }).catch((error) => console.error("achievement award failed:", error));
          }
          broadcast(message.payload.roomId, { type: "doc-update", payload: { update: message.payload.update, actorId: message.payload.actorId } }, message.payload.actorId);
          if (event) broadcast(message.payload.roomId, { type: "event", payload: event });
          if (updatedParticipant) broadcast(message.payload.roomId, { type: "participant-updated", payload: updatedParticipant });
          break;
        }
        case "awareness":
          broadcast(message.payload.roomId, { type: "awareness", payload: { update: message.payload.update } });
          break;
        case "run-code": {
          const meta = socketRooms.get(socket);
          if (!meta || meta.roomId !== message.payload.roomId) {
            send(socket, { type: "error", payload: { message: "Сначала подключитесь к комнате." } });
            break;
          }
          if (!canRun(meta.role)) {
            send(socket, { type: "error", payload: { message: "Роль viewer не может запускать код." } });
            break;
          }
          const terminalState = roomStore.resetTerminal(message.payload.roomId);
          broadcast(message.payload.roomId, { type: "execution-status", payload: terminalState });
          const result = await runPythonInSandbox({
            code: message.payload.code,
            onLine: (line) => {
              const terminal = roomStore.appendTerminalLine(message.payload.roomId, line);
              broadcast(message.payload.roomId, { type: "terminal-line", payload: line });
              broadcast(message.payload.roomId, { type: "execution-status", payload: terminal });
            },
          });
          const finishedTerminal = roomStore.finishExecution(message.payload.roomId, result.status);
          broadcast(message.payload.roomId, { type: "execution-status", payload: finishedTerminal });
          if (meta.userId && (result.status === "success" || result.status === "error")) {
            const runXp = result.status === "success" ? 20 : 5;
            void addXpEvent({
              roomId: message.payload.roomId,
              userId: meta.userId,
              points: runXp,
              eventType: "run",
            }).catch((error) => console.error("run xp event insert failed:", error));
          }
          if (meta.userId && result.status === "success") {
            void awardRoomAchievements({
              roomId: message.payload.roomId,
              userId: meta.userId,
              trigger: "run-success",
            }).catch((error) => console.error("run achievement award failed:", error));
          }
          break;
        }
        case "set-anonymous": {
          const meta = socketRooms.get(socket);
          if (!meta || !meta.userId || meta.userId !== message.payload.participantId) {
            send(socket, { type: "error", payload: { message: "Можно менять инкогнито только для своего профиля." } });
            break;
          }
          const updated = roomStore.setAnonymous(message.payload.roomId, message.payload.participantId, message.payload.isAnonymous);
          if (updated) broadcast(message.payload.roomId, { type: "participant-updated", payload: updated });
          break;
        }
        case "ping":
          send(socket, { type: "event", payload: { id: createId("evt"), type: "system", message: "Подключение активно", createdAt: new Date().toISOString() } });
          break;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Неизвестная ошибка сервера.";
      send(socket, { type: "error", payload: { message: messageText } });
    }
  });

  socket.on("close", () => {
    const metadata = socketRooms.get(socket);
    if (!metadata) return;
    socketRooms.delete(socket);
    touchRuntime(metadata.roomId);
    const event = roomStore.leaveRoom(metadata.roomId, metadata.participantId);
    if (!event) return;
    broadcast(metadata.roomId, { type: "participant-left", payload: { participantId: metadata.participantId } });
    broadcast(metadata.roomId, { type: "event", payload: event });
  });
});

void ensurePlatformSchema()
  .then(() => {
    server.listen(env.PORT, () => {
      console.log(`CollabCode server is running on http://localhost:${env.PORT}`);
    });
    setInterval(() => {
      void runRuntimeAutoStopSweep();
    }, 60 * 1000);
  })
  .catch((error) => {
    console.error("Не удалось подготовить schema платформы:", error);
    process.exit(1);
  });
