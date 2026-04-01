import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../config/env.js";

interface TokenPayload {
  sub: string;
  email: string;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(input: string): string {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(pad);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function sign(data: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
}

export function createAuthToken(payload: { userId: string; email: string }): string {
  const header = { alg: "HS256", typ: "JWT-lite" };
  const body: TokenPayload = {
    sub: payload.userId,
    email: payload.email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signature = sign(`${encodedHeader}.${encodedBody}`);
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

export function verifyAuthToken(token: string): { userId: string; email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedBody, signature] = parts;
  if (!encodedHeader || !encodedBody || !signature) {
    return null;
  }

  const expectedSignature = sign(`${encodedHeader}.${encodedBody}`);
  const left = Buffer.from(signature, "utf-8");
  const right = Buffer.from(expectedSignature, "utf-8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedBody)) as TokenPayload;
    if (!payload.sub || !payload.email || !payload.exp) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
