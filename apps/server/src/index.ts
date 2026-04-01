import http from "node:http";

import {
  type ClientMessage,
  type Participant,
  type ServerMessage,
} from "@collabcode/shared";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";

import { env } from "./config/env.js";
import { createAuthToken, verifyAuthToken } from "./lib/auth-token.js";
import { createId } from "./lib/id.js";
import { roomStore } from "./services/room-store.js";
import {
  createRoomForOwner,
  createUser,
  ensurePlatformSchema,
  findUserByEmail,
  getMembership,
  getRoomById,
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
  updateRoomGoal,
  validatePassword,
} from "./services/platform-store.js";
import {
  ensureRoomRuntimeArtifacts,
  inspectRoomContainerStatus,
  startRoomContainer,
  stopRoomContainer,
} from "./services/room-orchestrator.js";
import { runPythonInSandbox } from "./services/sandbox-runner.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((_request, response, next) => {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: http: https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval';",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(60),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const createRoomSchema = z.object({
  title: z.string().min(2).max(120),
  goal: z.string().min(3).max(500),
  visibility: z.enum(["open", "closed"]),
  accessCode: z.string().min(4).max(64).optional(),
});

const joinRoomSchema = z.object({
  accessCode: z.string().min(4).max(64).optional(),
});

const goalSchema = z.object({
  goal: z.string().min(3).max(500),
});

const roleSchema = z.object({
  targetUserId: z.string().min(3),
  role: z.enum(["editor", "viewer"]),
});

const anonymousSchema = z.object({
  isAnonymous: z.boolean(),
});

interface AuthenticatedRequest extends express.Request {
  auth?: { userId: string; email: string };
}

function requireAuth(
  request: AuthenticatedRequest,
  response: express.Response,
  next: express.NextFunction,
): void {
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
    response.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("login failed:", error);
    response.status(500).json({ message: "Не удалось выполнить вход." });
  }
});

app.get("/api/auth/me", requireAuth, async (request: AuthenticatedRequest, response) => {
  try {
    const user = await getUserById(request.auth!.userId);
    if (!user) {
      response.status(404).json({ message: "Пользователь не найден." });
      return;
    }
    response.json(user);
  } catch (error) {
    console.error("me failed:", error);
    response.status(500).json({ message: "Не удалось получить профиль." });
  }
});

app.get("/api/platform/rooms/my", requireAuth, async (request: AuthenticatedRequest, response) => {
  try {
    const rooms = await listRoomsForUser(request.auth!.userId);
    const roomsWithLiveOnline = rooms.map((room) => {
      const snapshot = roomStore.getSnapshot(room.id);
      const onlineCount = snapshot.participants.filter((participant) => participant.status === "online").length;
      return {
        ...room,
        onlineCount,
      };
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

    const runtime = await setRoomRuntimeStatusSystem({
      roomId,
      status: "running",
    });
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

    const runtime = await setRoomRuntimeStatusSystem({
      roomId,
      status: "stopped",
    });
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

app.get("/api/rooms/:roomId", (request, response) => {
  const snapshot = roomStore.getSnapshot(request.params.roomId);
  response.json(snapshot);
});

app.get("/api/home/:roomId", (request, response) => {
  const snapshot = roomStore.getSnapshot(request.params.roomId);
  const now = Date.now();
  const participantById = new Map(snapshot.participants.map((item) => [item.id, item.name]));

  const onlineParticipants = snapshot.participants.filter(
    (participant) => participant.status === "online",
  ).length;
  const totalParticipants = snapshot.participants.length;

  const suggestionSeverity = snapshot.suggestions.reduce(
    (acc, item) => {
      const current = acc[item.severity] ?? 0;
      acc[item.severity] = current + 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 },
  );

  const editEvents = snapshot.events.filter((event) => event.type === "edit");
  const aiEvents = snapshot.events.filter((event) => event.type === "ai");

  const trend = Array.from({ length: 12 }, () => 0);
  for (const event of editEvents) {
    const createdAt = new Date(event.createdAt).getTime();
    if (Number.isNaN(createdAt)) {
      continue;
    }
    const diffMinutes = (now - createdAt) / 60000;
    if (diffMinutes < 0 || diffMinutes >= 60) {
      continue;
    }
    const bin = 11 - Math.floor(diffMinutes / 5);
    if (bin >= 0 && bin < trend.length) {
      const current = trend[bin] ?? 0;
      trend[bin] = current + 1;
    }
  }

  const latestEditAt = editEvents
    .map((event) => new Date(event.createdAt).getTime())
    .filter((ts) => !Number.isNaN(ts))
    .sort((a, b) => b - a)[0];
  const latestAiAt = aiEvents
    .map((event) => new Date(event.createdAt).getTime())
    .filter((ts) => !Number.isNaN(ts))
    .sort((a, b) => b - a)[0];

  const aiReactionMs =
    latestEditAt && latestAiAt && latestAiAt >= latestEditAt
      ? latestAiAt - latestEditAt
      : null;

  const editsLastHour = trend.reduce((sum, value) => sum + value, 0);
  const throughputPerMinute = Number((editsLastHour / 60).toFixed(2));

  const high = suggestionSeverity.high;
  const medium = suggestionSeverity.medium;
  const low = suggestionSeverity.low;

  const securityScore = Math.max(15, 100 - high * 20 - medium * 7);
  const complexityScore = Math.max(20, 100 - medium * 12 - high * 9);
  const readabilityScore = Math.max(25, 100 - low * 6 - medium * 8);
  const performanceScore = (() => {
    switch (snapshot.terminal.status) {
      case "success":
        return 90;
      case "running":
        return 74;
      case "timeout":
        return 45;
      case "error":
        return 54;
      case "idle":
      default:
        return 82;
    }
  })();

  const collaborationIndex =
    totalParticipants > 0 ? onlineParticipants / totalParticipants : 0;
  const suggestionLoad = Math.min(1, snapshot.suggestions.length / 6);
  const recentEvents = snapshot.events.slice(0, 10).map((event) => {
    const actorName = event.participantId ? participantById.get(event.participantId) : null;
    const typeLabel = (() => {
      switch (event.type) {
        case "join":
          return "Подключение";
        case "leave":
          return "Выход";
        case "edit":
          return "Правка";
        case "run":
          return "Запуск";
        case "ai":
          return "ИИ-ревью";
        case "achievement":
          return "Достижение";
        case "rank-up":
          return "Повышение";
        case "system":
        default:
          return "Система";
      }
    })();

    const risk = (() => {
      if (event.type === "ai") {
        if (suggestionSeverity.high > 0) return "high" as const;
        if (suggestionSeverity.medium > 0) return "medium" as const;
        return "low" as const;
      }
      if (event.type === "run" && (snapshot.terminal.status === "error" || snapshot.terminal.status === "timeout")) {
        return "high" as const;
      }
      if (event.type === "system") return "medium" as const;
      return "low" as const;
    })();

    const status = (() => {
      if (event.type === "run") {
        return snapshot.terminal.status;
      }
      if (event.type === "ai" && suggestionSeverity.high > 0) {
        return "attention" as const;
      }
      return "ok" as const;
    })();

    return {
      id: event.id,
      type: event.type,
      typeLabel,
      message: event.message,
      actorName,
      createdAt: event.createdAt,
      risk,
      status,
    };
  });

  response.json({
    roomId: snapshot.roomId,
    participants: {
      online: onlineParticipants,
      total: totalParticipants,
    },
    ai: {
      suggestions: snapshot.suggestions.length,
      severity: suggestionSeverity,
      reactionMs: aiReactionMs,
      scores: {
        security: securityScore,
        complexity: complexityScore,
        readability: readabilityScore,
        performance: performanceScore,
      },
    },
    execution: {
      status: snapshot.terminal.status,
    },
    trend,
    throughputPerMinute,
    syncRate: totalParticipants > 0 ? Math.round((onlineParticipants / totalParticipants) * 100) : 100,
    model: "arcee-ai/trinity-large-preview",
    core: {
      collaborationIndex,
      suggestionLoad,
      stabilityIndex: Math.min(1, (securityScore + performanceScore) / 200),
    },
    recentEvents,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const socketRooms = new Map<WebSocket, { roomId: string; participantId: string }>();
let autoStopLock = false;

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function broadcast(roomId: string, message: ServerMessage, exceptParticipantId?: string): void {
  for (const [socket, metadata] of socketRooms.entries()) {
    if (metadata.roomId !== roomId) {
      continue;
    }

    if (exceptParticipantId && metadata.participantId === exceptParticipantId) {
      continue;
    }

    send(socket, message);
  }
}

function touchRuntime(roomId: string): void {
  void touchRoomRuntimeActivity(roomId).catch(() => {
    // runtime meta может не существовать для демо-комнаты; игнорируем.
  });
}

async function runRuntimeAutoStopSweep(): Promise<void> {
  if (autoStopLock) {
    return;
  }
  autoStopLock = true;
  try {
    const runtimes = await listRunningRoomRuntimes();
    const now = Date.now();
    const warningThresholdMs = 13 * 60 * 1000;
    const stopThresholdMs = 15 * 60 * 1000;

    for (const runtime of runtimes) {
      const lastActivityMs = runtime.lastActivityAt ? new Date(runtime.lastActivityAt).getTime() : now;
      const idleMs = now - lastActivityMs;

      if (idleMs >= stopThresholdMs) {
        await stopRoomContainer(runtime.containerId);
        await setRoomRuntimeStatusSystem({ roomId: runtime.roomId, status: "stopped" });
        await markRoomRuntimeWarning(runtime.roomId, null);
        const event = roomStore.pushSystemEvent(
          runtime.roomId,
          "Комната автоматически остановлена после 15 минут простоя.",
        );
        broadcast(runtime.roomId, { type: "event", payload: event });
        continue;
      }

      if (idleMs >= warningThresholdMs && !runtime.warningSentAt) {
        await markRoomRuntimeWarning(runtime.roomId, new Date());
        const event = roomStore.pushSystemEvent(
          runtime.roomId,
          "Внимание: через 2 минуты без активности контейнер комнаты будет автоматически остановлен.",
        );
        broadcast(runtime.roomId, { type: "event", payload: event });
      }
    }
  } catch (error) {
    console.error("auto-stop sweep failed:", error);
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
          const platformRoom = await getRoomById(message.payload.roomId);
          if (platformRoom) {
            const runtime = await getRoomRuntime(message.payload.roomId);
            if (!runtime || runtime.status !== "running") {
              send(socket, {
                type: "error",
                payload: { message: "Комната создана, но контейнер не запущен. Попросите владельца запустить комнату в кабинете." },
              });
              break;
            }
          }

          const currentSnapshot = roomStore.getSnapshot(message.payload.roomId);
          const onlineNow = currentSnapshot.participants.filter((item) => item.status === "online");
          const alreadyInRoom = onlineNow.some((item) => item.id === message.payload.participant.id);
          if (!alreadyInRoom && onlineNow.length >= 8) {
            send(socket, {
              type: "error",
              payload: { message: "Лимит комнаты: одновременно не более 8 онлайн-участников." },
            });
            break;
          }

          const participant: Participant = {
            ...message.payload.participant,
            status: "online",
            lastSeenAt: new Date().toISOString(),
          };
          socketRooms.set(socket, {
            roomId: message.payload.roomId,
            participantId: participant.id,
          });

          const { snapshot, event } = roomStore.joinRoom(message.payload.roomId, participant);
          touchRuntime(message.payload.roomId);
          send(socket, { type: "room-state", payload: snapshot });
          send(socket, {
            type: "doc-state",
            payload: { update: roomStore.getEncodedState(message.payload.roomId) },
          });
          broadcast(message.payload.roomId, { type: "participant-joined", payload: participant }, participant.id);
          broadcast(message.payload.roomId, { type: "event", payload: event }, participant.id);
          break;
        }

        case "request-doc-state": {
          touchRuntime(message.payload.roomId);
          send(socket, {
            type: "doc-state",
            payload: { update: roomStore.getEncodedState(message.payload.roomId) },
          });
          break;
        }

        case "doc-update": {
          touchRuntime(message.payload.roomId);
          const { event, updatedParticipant } = await roomStore.applyDocUpdate(
            message.payload.roomId,
            message.payload.actorId,
            message.payload.update,
            // onAiStart
            () => {
              broadcast(message.payload.roomId, { type: "ai-status", payload: { isProcessing: true } });
            },
            // onAiComplete
            (suggestions, aiEvent) => {
              broadcast(message.payload.roomId, { type: "ai-suggestions", payload: suggestions });
              if (aiEvent) {
                broadcast(message.payload.roomId, { type: "event", payload: aiEvent });
              }
              broadcast(message.payload.roomId, { type: "ai-status", payload: { isProcessing: false } });
            }
          );
          broadcast(message.payload.roomId, {
            type: "doc-update",
            payload: {
              update: message.payload.update,
              actorId: message.payload.actorId,
            },
          }, message.payload.actorId);
          if (event) {
            broadcast(message.payload.roomId, { type: "event", payload: event });
          }
          if (updatedParticipant) {
            broadcast(message.payload.roomId, { type: "participant-updated", payload: updatedParticipant });
          }
          break;
        }

        case "awareness": {
          touchRuntime(message.payload.roomId);
          broadcast(message.payload.roomId, {
            type: "awareness",
            payload: { update: message.payload.update },
          });
          break;
        }

        case "run-code": {
          touchRuntime(message.payload.roomId);
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
          break;
        }

        case "set-anonymous": {
          touchRuntime(message.payload.roomId);
          const updated = roomStore.setAnonymous(message.payload.roomId, message.payload.participantId, message.payload.isAnonymous);
          if (updated) {
            broadcast(message.payload.roomId, { type: "participant-updated", payload: updated });
          }
          break;
        }

        case "ping": {
          touchRuntime(message.payload.roomId);
          send(socket, { type: "event", payload: {
            id: createId("evt"),
            type: "system",
            message: "Подключение активно",
            createdAt: new Date().toISOString(),
          } });
          break;
        }
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Неизвестная ошибка сервера.";
      send(socket, { type: "error", payload: { message: messageText } });
    }
  });

  socket.on("close", () => {
    const metadata = socketRooms.get(socket);
    if (!metadata) {
      return;
    }

    socketRooms.delete(socket);
    touchRuntime(metadata.roomId);
    const event = roomStore.leaveRoom(metadata.roomId, metadata.participantId);
    if (!event) {
      return;
    }

    broadcast(metadata.roomId, {
      type: "participant-left",
      payload: { participantId: metadata.participantId },
    });
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
