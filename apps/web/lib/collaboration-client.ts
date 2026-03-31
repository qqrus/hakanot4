"use client";

import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import type {
  ClientMessage,
  ExecutionRequest,
  RoomSnapshot,
  ServerMessage,
  SessionEvent,
  TerminalLine,
} from "@collabcode/shared";

interface CollaborationCallbacks {
  onRoomState: (snapshot: RoomSnapshot) => void;
  onEvent: (event: SessionEvent) => void;
  onAiSuggestions: (suggestions: RoomSnapshot["suggestions"]) => void;
  onTerminalLine: (line: TerminalLine) => void;
  onExecutionStatus: (terminal: RoomSnapshot["terminal"]) => void;
  onParticipantJoined: (participant: RoomSnapshot["participants"][number]) => void;
  onParticipantLeft: (participantId: string) => void;
  onError: (message: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

export interface CollaborationParticipant {
  id: string;
  name: string;
  color: string;
  avatar: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export class CollaborationClient {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);

  private readonly callbacks: CollaborationCallbacks;
  private readonly roomId: string;
  private readonly wsUrl: string;
  private readonly participant: CollaborationParticipant;
  private socket: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private isDisposed = false;

  constructor(
    roomId: string,
    wsUrl: string,
    participant: CollaborationParticipant,
    callbacks: CollaborationCallbacks,
  ) {
    this.roomId = roomId;
    this.wsUrl = wsUrl;
    this.participant = participant;
    this.callbacks = callbacks;

    this.doc.on("update", (update, origin) => {
      if (origin === this) {
        return;
      }

      this.send({
        type: "doc-update",
        payload: {
          roomId: this.roomId,
          update: toBase64(update),
          actorId: this.participant.id,
        },
      });
    });

    this.awareness.on(
      "update",
      (
        {
          added,
          updated,
          removed,
        }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
      if (origin === this) {
        return;
      }

      const changedClients = [...added, ...updated, ...removed];
      if (changedClients.length === 0) {
        return;
      }

      this.send({
        type: "awareness",
        payload: {
          roomId: this.roomId,
          update: toBase64(encodeAwarenessUpdate(this.awareness, changedClients)),
        },
      });
      },
    );

    this.awareness.setLocalStateField("user", {
      name: participant.name,
      color: participant.color,
      avatar: participant.avatar,
    });
  }

  connect(): void {
    this.socket = new WebSocket(this.wsUrl);

    this.socket.addEventListener("open", () => {
      this.callbacks.onConnectionChange(true);
      this.send({
        type: "join-room",
        payload: {
          roomId: this.roomId,
          participant: {
            ...this.participant,
            status: "online",
            lastSeenAt: new Date().toISOString(),
          },
        },
      });
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      this.handleMessage(message);
    });

    this.socket.addEventListener("close", () => {
      this.callbacks.onConnectionChange(false);
      if (this.isDisposed) {
        return;
      }

      this.reconnectTimeout = window.setTimeout(() => this.connect(), 1200);
    });

    this.socket.addEventListener("error", () => {
      this.callbacks.onError("WebSocket соединение недоступно.");
    });
  }

  runCode(request: ExecutionRequest): void {
    this.send({ type: "run-code", payload: request });
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
    }
    this.awareness.destroy();
    this.doc.destroy();
    this.socket?.close();
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "room-state":
        this.callbacks.onRoomState(message.payload);
        break;
      case "doc-state":
        Y.applyUpdate(this.doc, fromBase64(message.payload.update), this);
        break;
      case "doc-update":
        Y.applyUpdate(this.doc, fromBase64(message.payload.update), this);
        break;
      case "awareness":
        applyAwarenessUpdate(this.awareness, fromBase64(message.payload.update), this);
        break;
      case "participant-joined":
        this.callbacks.onParticipantJoined(message.payload);
        break;
      case "participant-left":
        this.callbacks.onParticipantLeft(message.payload.participantId);
        break;
      case "event":
        this.callbacks.onEvent(message.payload);
        break;
      case "ai-suggestions":
        this.callbacks.onAiSuggestions(message.payload);
        break;
      case "terminal-line":
        this.callbacks.onTerminalLine(message.payload);
        break;
      case "execution-status":
        this.callbacks.onExecutionStatus(message.payload);
        break;
      case "error":
        this.callbacks.onError(message.payload.message);
        break;
    }
  }

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}
