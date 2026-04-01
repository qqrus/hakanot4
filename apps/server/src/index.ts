import http from "node:http";

import {
  type ClientMessage,
  type Participant,
  type ServerMessage,
} from "@collabcode/shared";
import cors from "cors";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";

import { env } from "./config/env.js";
import { createId } from "./lib/id.js";
import { roomStore } from "./services/room-store.js";
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
          send(socket, {
            type: "doc-state",
            payload: { update: roomStore.getEncodedState(message.payload.roomId) },
          });
          break;
        }

        case "doc-update": {
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
          broadcast(message.payload.roomId, { type: "event", payload: event });
          if (updatedParticipant) {
            broadcast(message.payload.roomId, { type: "participant-updated", payload: updatedParticipant });
          }
          break;
        }

        case "awareness": {
          broadcast(message.payload.roomId, {
            type: "awareness",
            payload: { update: message.payload.update },
          });
          break;
        }

        case "run-code": {
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
          const updated = roomStore.setAnonymous(message.payload.roomId, message.payload.participantId, message.payload.isAnonymous);
          if (updated) {
            broadcast(message.payload.roomId, { type: "participant-updated", payload: updated });
          }
          break;
        }

        case "ping": {
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

server.listen(env.PORT, () => {
  console.log(`CollabCode server is running on http://localhost:${env.PORT}`);
});
