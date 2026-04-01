export type ParticipantStatus = "online" | "offline";
export type EventType = "join" | "leave" | "edit" | "run" | "ai" | "system" | "achievement" | "rank-up";
export type SuggestionSeverity = "low" | "medium" | "high";
export type ExecutionStatus = "idle" | "running" | "success" | "error" | "timeout";

export interface Participant {
  id: string;
  name: string;
  color: string;
  avatar: string;
  status: ParticipantStatus;
  lastSeenAt: string;
  // Academic Rating
  xp: number;
  level: number;
  rank: string;
  isAnonymous: boolean;
  achievements: string[];
}

export interface SessionEvent {
  id: string;
  type: EventType;
  message: string;
  createdAt: string;
  participantId?: string;
  metadata?: Record<string, unknown>;
}

export interface AiSuggestion {
  id: string;
  severity: SuggestionSeverity;
  title: string;
  explanation: string;
  suggestedFix: string;
  createdAt: string;
  relatedRange?: {
    startLine: number;
    endLine: number;
  };
}

export interface TerminalLine {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
  createdAt: string;
}

export interface RoomSnapshot {
  roomId: string;
  fileName: string;
  language: string;
  participants: Participant[];
  suggestions: AiSuggestion[];
  events: SessionEvent[];
  terminal: {
    status: ExecutionStatus;
    lines: TerminalLine[];
    startedAt?: string;
    finishedAt?: string;
  };
}

export interface ExecutionRequest {
  roomId: string;
  code: string;
  language: "python";
}

export interface ExecutionResult {
  status: ExecutionStatus;
  exitCode: number | null;
  lines: TerminalLine[];
}

export interface MockReviewContext {
  roomId: string;
  previousCode: string;
  nextCode: string;
  changedBy: string;
}

export type ServerMessage =
  | { type: "room-state"; payload: RoomSnapshot }
  | { type: "doc-state"; payload: { update: string } }
  | { type: "doc-update"; payload: { update: string; actorId: string } }
  | { type: "awareness"; payload: { update: string } }
  | { type: "participant-joined"; payload: Participant }
  | { type: "participant-left"; payload: { participantId: string } }
  | { type: "participant-updated"; payload: Participant }
  | { type: "event"; payload: SessionEvent }
  | { type: "ai-suggestions"; payload: AiSuggestion[] }
  | { type: "execution-status"; payload: RoomSnapshot["terminal"] }
  | { type: "terminal-line"; payload: TerminalLine }
  | { type: "ai-status"; payload: { isProcessing: boolean } }
  | { type: "error"; payload: { message: string } };

export type ClientMessage =
  | { type: "join-room"; payload: { roomId: string; participant: Participant } }
  | { type: "request-doc-state"; payload: { roomId: string } }
  | { type: "doc-update"; payload: { roomId: string; update: string; actorId: string } }
  | { type: "awareness"; payload: { roomId: string; update: string } }
  | { type: "run-code"; payload: ExecutionRequest }
  | { type: "ping"; payload: { roomId: string } }
  | { type: "set-anonymous"; payload: { roomId: string; participantId: string; isAnonymous: boolean } };

export const DEMO_ROOM_ID = "demo-room";
export const DEFAULT_FILE_NAME = "main.py";
export const DEFAULT_LANGUAGE = "python";
