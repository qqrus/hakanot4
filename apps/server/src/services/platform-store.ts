import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { query } from "../lib/db.js";
import { createId } from "../lib/id.js";

export type RoomVisibility = "open" | "closed";
export type RoomRole = "owner" | "editor" | "viewer";
export type RuntimeStatus = "stopped" | "running" | "starting" | "stopping";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
  createdAt: string;
}

export interface RoomMeta {
  id: string;
  ownerId: string;
  title: string;
  goal: string;
  visibility: RoomVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface RoomMembership {
  roomId: string;
  userId: string;
  role: RoomRole;
  isAnonymous: boolean;
  joinedAt: string;
}

export interface RoomMemberInfo {
  roomId: string;
  userId: string;
  email: string;
  name: string;
  avatar: string;
  role: RoomRole;
  isAnonymous: boolean;
  joinedAt: string;
}

export interface RoomRuntime {
  roomId: string;
  containerId: string;
  status: RuntimeStatus;
  volumeName: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  warningSentAt: string | null;
}

function hashValue(value: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyHash(value: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) {
    return false;
  }
  const computed = scryptSync(value, salt, 64).toString("hex");
  return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expectedHash, "hex"));
}

function makeAvatar(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "CC";
}

export async function ensurePlatformSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS room_meta (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('open', 'closed')),
      access_code_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS room_memberships (
      room_id TEXT NOT NULL REFERENCES room_meta(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS room_runtime (
      room_id TEXT PRIMARY KEY REFERENCES room_meta(id) ON DELETE CASCADE,
      container_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('stopped', 'running', 'starting', 'stopping')),
      volume_name TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      last_activity_at TIMESTAMPTZ,
      warning_sent_at TIMESTAMPTZ
    );
  `);
  await query(`
    ALTER TABLE room_runtime
    ADD COLUMN IF NOT EXISTS warning_sent_at TIMESTAMPTZ;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS xp_events (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES room_meta(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      points INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<AuthUser> {
  const id = createId("usr");
  const passwordHash = hashValue(input.password);
  const avatar = makeAvatar(input.name);
  const rows = await query<{
    id: string;
    email: string;
    name: string;
    avatar: string;
    created_at: Date;
  }>(
    `
      INSERT INTO app_users (id, email, password_hash, name, avatar)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, name, avatar, created_at
    `,
    [id, input.email.toLowerCase(), passwordHash, input.name, avatar],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Не удалось создать пользователя.");
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByEmail(email: string): Promise<
  | (AuthUser & {
      passwordHash: string;
    })
  | null
> {
  const rows = await query<{
    id: string;
    email: string;
    name: string;
    avatar: string;
    password_hash: string;
    created_at: Date;
  }>(
    `
      SELECT id, email, name, avatar, password_hash, created_at
      FROM app_users
      WHERE email = $1
      LIMIT 1
    `,
    [email.toLowerCase()],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const rows = await query<{
    id: string;
    email: string;
    name: string;
    avatar: string;
    created_at: Date;
  }>(
    `
      SELECT id, email, name, avatar, created_at
      FROM app_users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    createdAt: row.created_at.toISOString(),
  };
}

export function validatePassword(password: string, passwordHash: string): boolean {
  return verifyHash(password, passwordHash);
}

export async function createRoomForOwner(input: {
  ownerId: string;
  title: string;
  goal: string;
  visibility: RoomVisibility;
  accessCode?: string;
}): Promise<RoomMeta> {
  const roomId = createId("room");
  const codeHash = input.visibility === "closed" ? hashValue(input.accessCode ?? "") : null;
  const roomRows = await query<{
    id: string;
    owner_id: string;
    title: string;
    goal: string;
    visibility: RoomVisibility;
    created_at: Date;
    updated_at: Date;
  }>(
    `
      INSERT INTO room_meta (id, owner_id, title, goal, visibility, access_code_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, owner_id, title, goal, visibility, created_at, updated_at
    `,
    [roomId, input.ownerId, input.title, input.goal, input.visibility, codeHash],
  );

  await query(
    `
      INSERT INTO room_memberships (room_id, user_id, role, is_anonymous)
      VALUES ($1, $2, 'owner', FALSE)
      ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'owner'
    `,
    [roomId, input.ownerId],
  );

  await query(
    `
      INSERT INTO room_runtime (room_id, container_id, status, volume_name, started_at, last_activity_at, warning_sent_at)
      VALUES ($1, $2, 'stopped', $3, NULL, NOW(), NULL)
      ON CONFLICT (room_id) DO NOTHING
    `,
    [roomId, `ctr_${roomId}`, `vol_${roomId}`],
  );

  const row = roomRows[0];
  if (!row) {
    throw new Error("Не удалось создать комнату.");
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    goal: row.goal,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listRoomsForUser(userId: string): Promise<
  Array<
    RoomMeta & {
      role: RoomRole;
      isAnonymous: boolean;
      runtime: RoomRuntime | null;
      onlineCount: number;
    }
  >
> {
  const rows = await query<{
    id: string;
    owner_id: string;
    title: string;
    goal: string;
    visibility: RoomVisibility;
    created_at: Date;
    updated_at: Date;
    role: RoomRole;
    is_anonymous: boolean;
    container_id: string | null;
    runtime_status: RuntimeStatus | null;
    volume_name: string | null;
    started_at: Date | null;
    last_activity_at: Date | null;
    warning_sent_at: Date | null;
  }>(
    `
      SELECT
        rm.id,
        rm.owner_id,
        rm.title,
        rm.goal,
        rm.visibility,
        rm.created_at,
        rm.updated_at,
        m.role,
        m.is_anonymous,
        rr.container_id,
        rr.status AS runtime_status,
        rr.volume_name,
        rr.started_at,
        rr.last_activity_at,
        rr.warning_sent_at
      FROM room_memberships m
      JOIN room_meta rm ON rm.id = m.room_id
      LEFT JOIN room_runtime rr ON rr.room_id = rm.id
      WHERE m.user_id = $1
      ORDER BY rm.updated_at DESC
    `,
    [userId],
  );

  const onlineRows = await query<{ room_id: string; online_count: number }>(
    `
      SELECT room_id, COUNT(*)::int AS online_count
      FROM room_memberships
      GROUP BY room_id
    `,
  );
  const onlineMap = new Map(onlineRows.map((item) => [item.room_id, item.online_count]));

  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    goal: row.goal,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    role: row.role,
    isAnonymous: row.is_anonymous,
    onlineCount: onlineMap.get(row.id) ?? 0,
    runtime: row.container_id && row.runtime_status && row.volume_name
      ? {
          roomId: row.id,
          containerId: row.container_id,
          status: row.runtime_status,
          volumeName: row.volume_name,
          startedAt: row.started_at ? row.started_at.toISOString() : null,
          lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null,
          warningSentAt: row.warning_sent_at ? row.warning_sent_at.toISOString() : null,
        }
      : null,
  }));
}

export async function getRoomById(roomId: string): Promise<(RoomMeta & { accessCodeHash: string | null }) | null> {
  const rows = await query<{
    id: string;
    owner_id: string;
    title: string;
    goal: string;
    visibility: RoomVisibility;
    access_code_hash: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `
      SELECT id, owner_id, title, goal, visibility, access_code_hash, created_at, updated_at
      FROM room_meta
      WHERE id = $1
      LIMIT 1
    `,
    [roomId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    goal: row.goal,
    visibility: row.visibility,
    accessCodeHash: row.access_code_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getMembership(roomId: string, userId: string): Promise<RoomMembership | null> {
  const rows = await query<{
    room_id: string;
    user_id: string;
    role: RoomRole;
    is_anonymous: boolean;
    joined_at: Date;
  }>(
    `
      SELECT room_id, user_id, role, is_anonymous, joined_at
      FROM room_memberships
      WHERE room_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [roomId, userId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role,
    isAnonymous: row.is_anonymous,
    joinedAt: row.joined_at.toISOString(),
  };
}

export async function listRoomMembers(roomId: string, requesterId: string): Promise<RoomMemberInfo[]> {
  const membership = await getMembership(roomId, requesterId);
  if (!membership) {
    throw new Error("Нет доступа к участникам этой комнаты.");
  }

  const rows = await query<{
    room_id: string;
    user_id: string;
    email: string;
    name: string;
    avatar: string;
    role: RoomRole;
    is_anonymous: boolean;
    joined_at: Date;
  }>(
    `
      SELECT
        m.room_id,
        m.user_id,
        u.email,
        u.name,
        u.avatar,
        m.role,
        m.is_anonymous,
        m.joined_at
      FROM room_memberships m
      JOIN app_users u ON u.id = m.user_id
      WHERE m.room_id = $1
      ORDER BY
        CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
        m.joined_at ASC
    `,
    [roomId],
  );

  return rows.map((row) => ({
    roomId: row.room_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    role: row.role,
    isAnonymous: row.is_anonymous,
    joinedAt: row.joined_at.toISOString(),
  }));
}

export async function joinRoom(input: {
  roomId: string;
  userId: string;
  accessCode?: string;
}): Promise<RoomMembership> {
  const room = await getRoomById(input.roomId);
  if (!room) {
    throw new Error("Комната не найдена.");
  }

  if (room.visibility === "closed") {
    if (!input.accessCode || !room.accessCodeHash || !verifyHash(input.accessCode, room.accessCodeHash)) {
      throw new Error("Неверный код доступа.");
    }
  }

  const existing = await getMembership(input.roomId, input.userId);
  if (existing) {
    return existing;
  }

  const rows = await query<{
    room_id: string;
    user_id: string;
    role: RoomRole;
    is_anonymous: boolean;
    joined_at: Date;
  }>(
    `
      INSERT INTO room_memberships (room_id, user_id, role, is_anonymous)
      VALUES ($1, $2, 'editor', FALSE)
      RETURNING room_id, user_id, role, is_anonymous, joined_at
    `,
    [input.roomId, input.userId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Не удалось присоединиться к комнате.");
  }
  return {
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role,
    isAnonymous: row.is_anonymous,
    joinedAt: row.joined_at.toISOString(),
  };
}

export async function updateRoomGoal(input: {
  roomId: string;
  ownerId: string;
  goal: string;
}): Promise<RoomMeta> {
  const rows = await query<{
    id: string;
    owner_id: string;
    title: string;
    goal: string;
    visibility: RoomVisibility;
    created_at: Date;
    updated_at: Date;
  }>(
    `
      UPDATE room_meta
      SET goal = $1, updated_at = NOW()
      WHERE id = $2 AND owner_id = $3
      RETURNING id, owner_id, title, goal, visibility, created_at, updated_at
    `,
    [input.goal, input.roomId, input.ownerId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Изменить цель может только владелец комнаты.");
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    goal: row.goal,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function updateMemberRole(input: {
  roomId: string;
  ownerId: string;
  targetUserId: string;
  role: RoomRole;
}): Promise<RoomMembership> {
  const room = await getRoomById(input.roomId);
  if (!room || room.ownerId !== input.ownerId) {
    throw new Error("Роль может менять только владелец комнаты.");
  }
  if (input.targetUserId === input.ownerId) {
    throw new Error("Роль владельца нельзя изменить.");
  }

  const rows = await query<{
    room_id: string;
    user_id: string;
    role: RoomRole;
    is_anonymous: boolean;
    joined_at: Date;
  }>(
    `
      UPDATE room_memberships
      SET role = $1
      WHERE room_id = $2 AND user_id = $3
      RETURNING room_id, user_id, role, is_anonymous, joined_at
    `,
    [input.role, input.roomId, input.targetUserId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Участник не найден в комнате.");
  }
  return {
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role,
    isAnonymous: row.is_anonymous,
    joinedAt: row.joined_at.toISOString(),
  };
}

export async function setAnonymousMode(input: {
  roomId: string;
  userId: string;
  isAnonymous: boolean;
}): Promise<RoomMembership> {
  const room = await getRoomById(input.roomId);
  if (!room) {
    throw new Error("Комната не найдена.");
  }
  if (room.visibility === "closed" && input.isAnonymous) {
    throw new Error("В закрытых комнатах инкогнито отключено.");
  }

  const rows = await query<{
    room_id: string;
    user_id: string;
    role: RoomRole;
    is_anonymous: boolean;
    joined_at: Date;
  }>(
    `
      UPDATE room_memberships
      SET is_anonymous = $1
      WHERE room_id = $2 AND user_id = $3
      RETURNING room_id, user_id, role, is_anonymous, joined_at
    `,
    [input.isAnonymous, input.roomId, input.userId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Участник не найден в комнате.");
  }
  return {
    roomId: row.room_id,
    userId: row.user_id,
    role: row.role,
    isAnonymous: row.is_anonymous,
    joinedAt: row.joined_at.toISOString(),
  };
}

export async function setRoomRuntimeStatus(input: {
  roomId: string;
  ownerId: string;
  status: RuntimeStatus;
}): Promise<RoomRuntime> {
  const room = await getRoomById(input.roomId);
  if (!room || room.ownerId !== input.ownerId) {
    throw new Error("Управлять запуском комнаты может только владелец.");
  }

  const rows = await query<{
    room_id: string;
    container_id: string;
    status: RuntimeStatus;
    volume_name: string;
    started_at: Date | null;
    last_activity_at: Date | null;
    warning_sent_at: Date | null;
  }>(
    `
      UPDATE room_runtime
      SET
        status = $1,
        started_at = CASE WHEN $1 = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
        last_activity_at = NOW(),
        warning_sent_at = NULL
      WHERE room_id = $2
      RETURNING room_id, container_id, status, volume_name, started_at, last_activity_at, warning_sent_at
    `,
    [input.status, input.roomId],
  );

  const row = rows[0];
  if (!row) {
    throw new Error("Runtime комнаты не найден.");
  }
  return {
    roomId: row.room_id,
    containerId: row.container_id,
    status: row.status,
    volumeName: row.volume_name,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null,
    warningSentAt: row.warning_sent_at ? row.warning_sent_at.toISOString() : null,
  };
}

export async function setRoomRuntimeStatusSystem(input: {
  roomId: string;
  status: RuntimeStatus;
}): Promise<RoomRuntime> {
  const rows = await query<{
    room_id: string;
    container_id: string;
    status: RuntimeStatus;
    volume_name: string;
    started_at: Date | null;
    last_activity_at: Date | null;
    warning_sent_at: Date | null;
  }>(
    `
      UPDATE room_runtime
      SET
        status = $1,
        started_at = CASE
          WHEN $1 = 'running' THEN COALESCE(started_at, NOW())
          WHEN $1 = 'stopped' THEN NULL
          ELSE started_at
        END,
        last_activity_at = NOW(),
        warning_sent_at = NULL
      WHERE room_id = $2
      RETURNING room_id, container_id, status, volume_name, started_at, last_activity_at, warning_sent_at
    `,
    [input.status, input.roomId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Runtime комнаты не найден.");
  }
  return {
    roomId: row.room_id,
    containerId: row.container_id,
    status: row.status,
    volumeName: row.volume_name,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null,
    warningSentAt: row.warning_sent_at ? row.warning_sent_at.toISOString() : null,
  };
}

export async function getRoomRuntime(roomId: string): Promise<RoomRuntime | null> {
  const rows = await query<{
    room_id: string;
    container_id: string;
    status: RuntimeStatus;
    volume_name: string;
    started_at: Date | null;
    last_activity_at: Date | null;
    warning_sent_at: Date | null;
  }>(
    `
      SELECT room_id, container_id, status, volume_name, started_at, last_activity_at, warning_sent_at
      FROM room_runtime
      WHERE room_id = $1
      LIMIT 1
    `,
    [roomId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    roomId: row.room_id,
    containerId: row.container_id,
    status: row.status,
    volumeName: row.volume_name,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null,
    warningSentAt: row.warning_sent_at ? row.warning_sent_at.toISOString() : null,
  };
}

export async function touchRoomRuntimeActivity(roomId: string): Promise<void> {
  await query(
    `
      UPDATE room_runtime
      SET last_activity_at = NOW(), warning_sent_at = NULL
      WHERE room_id = $1
    `,
    [roomId],
  );
}

export async function markRoomRuntimeWarning(roomId: string, warningAt: Date | null): Promise<void> {
  await query(
    `
      UPDATE room_runtime
      SET warning_sent_at = $1
      WHERE room_id = $2
    `,
    [warningAt, roomId],
  );
}

export async function listRunningRoomRuntimes(): Promise<RoomRuntime[]> {
  const rows = await query<{
    room_id: string;
    container_id: string;
    status: RuntimeStatus;
    volume_name: string;
    started_at: Date | null;
    last_activity_at: Date | null;
    warning_sent_at: Date | null;
  }>(
    `
      SELECT room_id, container_id, status, volume_name, started_at, last_activity_at, warning_sent_at
      FROM room_runtime
      WHERE status = 'running'
    `,
  );
  return rows.map((row) => ({
    roomId: row.room_id,
    containerId: row.container_id,
    status: row.status,
    volumeName: row.volume_name,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null,
    warningSentAt: row.warning_sent_at ? row.warning_sent_at.toISOString() : null,
  }));
}
