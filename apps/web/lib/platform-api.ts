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
