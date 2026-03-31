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
import { demoRoom, sampleCode } from "./demo-data.js";
import { reviewCodeDiff } from "./mock-ai-reviewer.js";

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
  const initialCode = roomId === DEMO_ROOM_ID ? sampleCode : sampleCode;
  text.insert(0, initialCode);

  const room = {
    roomId,
    fileName: roomId === DEMO_ROOM_ID ? demoRoom.fileName : DEFAULT_FILE_NAME,
    language: roomId === DEMO_ROOM_ID ? demoRoom.language : DEFAULT_LANGUAGE,
    ydoc,
    text,
    participants: new Map<string, Participant>(),
    events: [createEvent("system", `Комната ${roomId} готова к совместной работе.`)],
    suggestions: [],
    terminal: {
      status: "idle" as const,
      lines: [],
    },
  } satisfies RoomState;

  return room;
}

class RoomStore {
  private readonly rooms = new Map<string, RoomState>();

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

  applyDocUpdate(roomId: string, actorId: string, updateBase64: string): { event: SessionEvent; suggestions: AiSuggestion[] } {
    const room = this.getOrCreate(roomId);
    const previousCode = room.text.toString();
    const update = Uint8Array.from(Buffer.from(updateBase64, "base64"));
    Y.applyUpdate(room.ydoc, update, "remote");
    const nextCode = room.text.toString();

    const event = createEvent("edit", "Документ обновлен", actorId);
    room.suggestions = reviewCodeDiff({
      roomId,
      previousCode,
      nextCode,
      changedBy: actorId,
    });

    const aiEvent = createEvent("ai", `AI reviewer обновил ${room.suggestions.length} подсказки`, actorId);
    room.events = [aiEvent, event, ...room.events].slice(0, 50);
    return { event, suggestions: room.suggestions };
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

  private toSnapshot(room: RoomState): RoomSnapshot {
    return {
      roomId: room.roomId,
      fileName: room.fileName,
      language: room.language,
      participants: Array.from(room.participants.values()),
      suggestions: room.suggestions,
      events: room.events,
      terminal: room.terminal,
    };
  }
}

export const roomStore = new RoomStore();
