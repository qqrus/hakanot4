const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const tokenKey = "collabcode_auth_token";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
  createdAt: string;
}

export interface PlatformRoom {
  id: string;
  ownerId: string;
  title: string;
  goal: string;
  visibility: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  role: "owner" | "editor" | "viewer";
  isAnonymous: boolean;
  onlineCount: number;
  runtime: {
    roomId: string;
    containerId: string;
    status: "stopped" | "running" | "starting" | "stopping";
    volumeName: string;
    startedAt: string | null;
    lastActivityAt: string | null;
  } | null;
}

export interface PlatformRoomMember {
  roomId: string;
  userId: string;
  email: string;
  name: string;
  avatar: string;
  role: "owner" | "editor" | "viewer";
  isAnonymous: boolean;
  joinedAt: string;
}

export interface PlatformRoomMetaResponse {
  room: {
    id: string;
    ownerId: string;
    title: string;
    goal: string;
    visibility: "open" | "closed";
    createdAt: string;
    updatedAt: string;
  };
  membership: {
    roomId: string;
    userId: string;
    role: "owner" | "editor" | "viewer";
    isAnonymous: boolean;
    joinedAt: string;
  };
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  avatar: string;
  totalXp: number;
  eventsCount: number;
  level: number;
  rank: string;
  achievementsCount: number;
}

export interface UserAchievement {
  id: string;
  userId: string;
  roomId: string | null;
  code: string;
  title: string;
  description: string;
  awardedAt: string;
}

export interface GamificationSummary {
  totalXp: number;
  eventsCount: number;
  level: number;
  rank: string;
  nextLevelXp: number;
  achievements: UserAchievement[];
}

export interface IntegrationStatus {
  telegramConfigured: boolean;
  discordConfigured: boolean;
}

export interface RoomIntegrationSettings {
  roomId: string;
  telegramChatId: string | null;
  discordWebhookUrl: string | null;
  discordNickname: string | null;
  updatedAt: string;
}

export interface AiProviderStatus {
  enabled: boolean;
  provider: "openrouter";
  model: string;
}

export interface IntegrationDeliveryReport {
  telegram: "sent" | "skipped" | "failed";
  discord: "sent" | "skipped" | "failed";
  errors: string[];
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(tokenKey);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(tokenKey, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(tokenKey);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Ошибка API (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function register(payload: { email: string; password: string; name: string }): Promise<AuthUser> {
  const result = await request<{ token: string; user: AuthUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setToken(result.token);
  return result.user;
}

export async function login(payload: { email: string; password: string }): Promise<AuthUser> {
  const result = await request<{ token: string; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setToken(result.token);
  return result.user;
}

export async function getMe(): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me");
}

export async function createRoom(payload: {
  title: string;
  goal: string;
  visibility: "open" | "closed";
  accessCode?: string;
}): Promise<void> {
  await request("/api/platform/rooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getMyRooms(): Promise<PlatformRoom[]> {
  const result = await request<{ rooms: PlatformRoom[] }>("/api/platform/rooms/my");
  return result.rooms;
}

export async function startRoom(roomId: string): Promise<void> {
  await request(`/api/platform/rooms/${encodeURIComponent(roomId)}/runtime/start`, {
    method: "POST",
  });
}

export async function stopRoom(roomId: string): Promise<void> {
  await request(`/api/platform/rooms/${encodeURIComponent(roomId)}/runtime/stop`, {
    method: "POST",
  });
}

export async function updateGoal(roomId: string, goal: string): Promise<void> {
  await request(`/api/platform/rooms/${encodeURIComponent(roomId)}/goal`, {
    method: "PATCH",
    body: JSON.stringify({ goal }),
  });
}

export async function joinRoomWithCode(roomId: string, accessCode?: string): Promise<void> {
  await request(`/api/platform/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    body: JSON.stringify({ accessCode }),
  });
}

export async function getRoomMembers(roomId: string): Promise<PlatformRoomMember[]> {
  const result = await request<{ members: PlatformRoomMember[] }>(
    `/api/platform/rooms/${encodeURIComponent(roomId)}/members`,
  );
  return result.members;
}

export async function getRoomMeta(roomId: string): Promise<PlatformRoomMetaResponse> {
  return request<PlatformRoomMetaResponse>(`/api/platform/rooms/${encodeURIComponent(roomId)}/meta`);
}

export async function setMemberRole(
  roomId: string,
  targetUserId: string,
  role: "editor" | "viewer",
): Promise<void> {
  await request(`/api/platform/rooms/${encodeURIComponent(roomId)}/role`, {
    method: "POST",
    body: JSON.stringify({ targetUserId, role }),
  });
}

export async function setAnonymousMode(
  roomId: string,
  isAnonymous: boolean,
): Promise<void> {
  await request(`/api/platform/rooms/${encodeURIComponent(roomId)}/anonymous`, {
    method: "POST",
    body: JSON.stringify({ isAnonymous }),
  });
}

export async function getLeaderboard(params?: {
  roomId?: string;
  limit?: number;
}): Promise<LeaderboardEntry[]> {
  const query = new URLSearchParams();
  if (params?.roomId) {
    query.set("roomId", params.roomId);
  }
  if (params?.limit) {
    query.set("limit", String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await request<{ leaderboard: LeaderboardEntry[] }>(`/api/platform/leaderboard${suffix}`);
  return result.leaderboard;
}

export async function getGamificationSummary(roomId?: string): Promise<GamificationSummary> {
  const query = new URLSearchParams();
  if (roomId) {
    query.set("roomId", roomId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const result = await request<{ summary: GamificationSummary }>(`/api/platform/gamification/summary${suffix}`);
  return result.summary;
}

export async function askNavigator(roomId: string, question: string): Promise<{
  answer: string;
  source: "openrouter" | "mock";
}> {
  return request(`/api/platform/rooms/${encodeURIComponent(roomId)}/navigator`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export async function sendIntegrationTest(): Promise<void> {
  await request("/api/platform/integrations/test", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function sendIntegrationDiagnostics(): Promise<{
  ok: boolean;
  integrations: IntegrationStatus;
  delivery: IntegrationDeliveryReport;
}> {
  return request("/api/platform/integrations/test", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getIntegrationsStatus(): Promise<IntegrationStatus> {
  const result = await request<{ integrations: IntegrationStatus }>("/api/platform/integrations/status");
  return result.integrations;
}

export async function getAiStatus(): Promise<AiProviderStatus> {
  const result = await request<{ ai: AiProviderStatus }>("/api/platform/ai/status");
  return result.ai;
}

export async function getRoomIntegrations(roomId: string): Promise<RoomIntegrationSettings> {
  const result = await request<{ integrations: RoomIntegrationSettings }>(
    `/api/platform/rooms/${encodeURIComponent(roomId)}/integrations`,
  );
  return result.integrations;
}

export async function updateRoomIntegrations(
  roomId: string,
  payload: {
    telegramChatId?: string | null;
    discordWebhookUrl?: string | null;
    discordNickname?: string | null;
  },
): Promise<RoomIntegrationSettings> {
  const result = await request<{ integrations: RoomIntegrationSettings }>(
    `/api/platform/rooms/${encodeURIComponent(roomId)}/integrations`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return result.integrations;
}

export async function testRoomIntegrations(roomId: string): Promise<{
  ok: boolean;
  integrations: IntegrationStatus;
  delivery: IntegrationDeliveryReport;
}> {
  return request(`/api/platform/rooms/${encodeURIComponent(roomId)}/integrations/test`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
