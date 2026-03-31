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
          const { event, suggestions } = roomStore.applyDocUpdate(
            message.payload.roomId,
            message.payload.actorId,
            message.payload.update,
          );
          broadcast(message.payload.roomId, {
            type: "doc-update",
            payload: {
              update: message.payload.update,
              actorId: message.payload.actorId,
            },
          }, message.payload.actorId);
          broadcast(message.payload.roomId, { type: "event", payload: event });
          broadcast(message.payload.roomId, { type: "ai-suggestions", payload: suggestions });
          send(socket, { type: "ai-suggestions", payload: suggestions });
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
