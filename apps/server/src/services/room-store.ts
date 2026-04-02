import * as Y from "yjs";

import {
  DEFAULT_FILE_NAME,
  DEFAULT_LANGUAGE,
  DEMO_ROOM_ID,
  type AiSuggestion,
  type Participant,
  type RoomSnapshot,
  type SessionEvent,
  type TerminalLine,
} from "@collabcode/shared";

import { createId } from "../lib/id.js";
import { reviewCodeWithAi } from "./ai-service.js";
import { demoRoom, sampleCode } from "./demo-data.js";
import { gamificationService } from "./gamification-service.js";

interface RoomState {
  roomId: string;
  fileName: string;
  language: string;
  ydoc: Y.Doc;
  text: Y.Text;
  participants: Map<string, Participant>;
  events: SessionEvent[];
  suggestions: AiSuggestion[];
  terminal: RoomSnapshot["terminal"];
  ai: RoomSnapshot["ai"];
}

function createEvent(
  type: SessionEvent["type"],
  message: string,
  participantId?: string,
): SessionEvent {
  return {
    id: createId("evt"),
    type,
    message,
    createdAt: new Date().toISOString(),
    participantId,
  };
}

function createRoom(roomId: string): RoomState {
  const ydoc = new Y.Doc();
  const text = ydoc.getText("monaco");
  text.insert(0, sampleCode);

  return {
    roomId,
    fileName: roomId === DEMO_ROOM_ID ? demoRoom.fileName : DEFAULT_FILE_NAME,
    language: roomId === DEMO_ROOM_ID ? demoRoom.language : DEFAULT_LANGUAGE,
    ydoc,
    text,
    participants: new Map<string, Participant>(),
    events: [createEvent("system", `Комната ${roomId} готова к работе.`)],
    suggestions: [],
    terminal: {
      status: "idle",
      lines: [],
    },
    ai: {
      status: "idle",
      source: "mock",
      message: "Ожидание изменений кода.",
      updatedAt: new Date().toISOString(),
    },
  };
}

class RoomStore {
  private readonly rooms = new Map<string, RoomState>();
  private readonly aiDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastEditEventAt = new Map<string, number>();

  getOrCreate(roomId: string): RoomState {
    const existingRoom = this.rooms.get(roomId);
    if (existingRoom) {
      return existingRoom;
    }

    const nextRoom = createRoom(roomId);
    this.rooms.set(roomId, nextRoom);
    return nextRoom;
  }

  joinRoom(roomId: string, participant: Participant): { snapshot: RoomSnapshot; event: SessionEvent } {
    const room = this.getOrCreate(roomId);
    room.participants.set(participant.id, participant);
    const event = createEvent("join", `${participant.name} присоединился к комнате`, participant.id);
    room.events = [event, ...room.events].slice(0, 50);
    return { snapshot: this.toSnapshot(room), event };
  }

  leaveRoom(roomId: string, participantId: string): SessionEvent | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return null;
    }

    room.participants.set(participantId, {
      ...participant,
      status: "offline",
      lastSeenAt: new Date().toISOString(),
    });

    const event = createEvent("leave", `${participant.name} отключился`, participantId);
    room.events = [event, ...room.events].slice(0, 50);
    return event;
  }

  async applyDocUpdate(
    roomId: string,
    actorId: string,
    updateBase64: string,
    onAiStart?: (state: RoomSnapshot["ai"]) => void,
    onAiComplete?: (state: RoomSnapshot["ai"], suggestions: AiSuggestion[], event?: SessionEvent) => void,
  ): Promise<{ event?: SessionEvent; updatedParticipant?: Participant; xpDelta: number }> {
    const room = this.getOrCreate(roomId);
    const previousCode = room.text.toString();
    const update = Uint8Array.from(Buffer.from(updateBase64, "base64"));
    Y.applyUpdate(room.ydoc, update, "remote");
    const nextCode = room.text.toString();

    const throttleKey = `${roomId}:${actorId}`;
    const now = Date.now();
    const prevEditAt = this.lastEditEventAt.get(throttleKey) ?? 0;
    const shouldEmitEditEvent = now - prevEditAt >= 3500;
    const event = shouldEmitEditEvent ? createEvent("edit", "Документ обновлен", actorId) : undefined;
    if (shouldEmitEditEvent) {
      this.lastEditEventAt.set(throttleKey, now);
    }

    let updatedParticipant: Participant | undefined;
    let xpDelta = 0;
    const participant = room.participants.get(actorId);
    if (participant) {
      const { updatedParticipant: nextParticipant, events: rankEvents } = gamificationService.awardXP(participant, 10);
      room.participants.set(actorId, nextParticipant);
      updatedParticipant = nextParticipant;
      xpDelta = 10;
      room.events = [...rankEvents, ...room.events].slice(0, 50);
    }
    if (event) {
      room.events = [event, ...room.events].slice(0, 50);
    }

    if (this.aiDebounceTimers.has(roomId)) {
      clearTimeout(this.aiDebounceTimers.get(roomId)!);
    }

    this.aiDebounceTimers.set(
      roomId,
      setTimeout(() => {
        room.ai = {
          status: "processing",
          source: room.ai.source,
          message: "ИИ анализирует последние изменения...",
          updatedAt: new Date().toISOString(),
        };
        if (onAiStart) {
          onAiStart(room.ai);
        }

        reviewCodeWithAi({
          roomId,
          previousCode,
          nextCode,
          changedBy: actorId,
        })
          .then((result) => {
            room.suggestions = result.suggestions;
            room.ai = {
              status: result.status,
              source: result.source,
              message: result.message,
              updatedAt: new Date().toISOString(),
            };

            let aiEvent: SessionEvent | undefined;
            if (result.suggestions.length > 0) {
              aiEvent = createEvent("ai", `ИИ-ассистент обнаружил ${result.suggestions.length} зон для улучшения`, actorId);
              room.events = [aiEvent, ...room.events].slice(0, 50);
            }
            if (onAiComplete) {
              onAiComplete(room.ai, result.suggestions, aiEvent);
            }
          })
          .catch((error: unknown) => {
            console.error(error);
            room.ai = {
              status: "error",
              source: room.ai.source,
              message: "Ошибка AI-анализа. Попробуйте снова.",
              updatedAt: new Date().toISOString(),
            };
            if (onAiComplete) {
              onAiComplete(room.ai, [], undefined);
            }
          });
      }, 3000),
    );

    return { event, updatedParticipant, xpDelta };
  }

  setAnonymous(roomId: string, participantId: string, isAnonymous: boolean): Participant | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    const participant = room.participants.get(participantId);
    if (!participant) {
      return null;
    }
    const updated = { ...participant, isAnonymous };
    room.participants.set(participantId, updated);
    return updated;
  }

  resetTerminal(roomId: string): RoomSnapshot["terminal"] {
    const room = this.getOrCreate(roomId);
    room.terminal = {
      status: "running",
      lines: [],
      startedAt: new Date().toISOString(),
    };
    const event = createEvent("run", "Запущено выполнение кода");
    room.events = [event, ...room.events].slice(0, 50);
    return room.terminal;
  }

  appendTerminalLine(roomId: string, line: TerminalLine): RoomSnapshot["terminal"] {
    const room = this.getOrCreate(roomId);
    room.terminal.lines = [...room.terminal.lines, line].slice(-300);
    return room.terminal;
  }

  finishExecution(roomId: string, status: RoomSnapshot["terminal"]["status"]): RoomSnapshot["terminal"] {
    const room = this.getOrCreate(roomId);
    room.terminal = {
      ...room.terminal,
      status,
      finishedAt: new Date().toISOString(),
    };
    return room.terminal;
  }

  getEncodedState(roomId: string): string {
    const room = this.getOrCreate(roomId);
    return Buffer.from(Y.encodeStateAsUpdate(room.ydoc)).toString("base64");
  }

  getCode(roomId: string): string {
    return this.getOrCreate(roomId).text.toString();
  }

  getSnapshot(roomId: string): RoomSnapshot {
    return this.toSnapshot(this.getOrCreate(roomId));
  }

  getRecentContext(roomId: string): {
    code: string;
    recentEvents: string[];
    recentSuggestions: string[];
  } {
    const room = this.getOrCreate(roomId);
    return {
      code: room.text.toString(),
      recentEvents: room.events.slice(0, 10).map((item) => item.message),
      recentSuggestions: room.suggestions.slice(0, 5).map((item) => `${item.title}: ${item.explanation}`),
    };
  }

  pushSystemEvent(roomId: string, message: string): SessionEvent {
    const room = this.getOrCreate(roomId);
    const event = createEvent("system", message);
    room.events = [event, ...room.events].slice(0, 50);
    return event;
  }

  private toSnapshot(room: RoomState): RoomSnapshot {
    return {
      roomId: room.roomId,
      fileName: room.fileName,
      language: room.language,
      participants: Array.from(room.participants.values()),
      suggestions: room.suggestions,
      events: room.events,
      terminal: room.terminal,
      ai: room.ai,
    };
  }
}

export const roomStore = new RoomStore();
