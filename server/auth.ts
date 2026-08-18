import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { parseCookie } from "cookie";
import { query } from "./db.js";
import { config } from "./config.js";

const scryptAsync = promisify(scrypt);
const LEGACY_SESSION_COOKIE = "cs_session";
export const SESSION_COOKIE = config.isProduction ? "__Host-barsik_session" : LEGACY_SESSION_COOKIE;

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarUrl: string | null;
  lastSeenAt: string | Date;
  createdAt: string | Date;
};

export type AuthenticatedRequest = Request & { user: AuthUser; sessionHash: string };

type UserRow = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_color: string;
  avatar_storage_name?: string | null;
  avatar_updated_at?: Date | null;
  last_seen_at: Date;
  created_at: Date;
};

export function publicUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_storage_name
      ? `/api/users/${row.id}/avatar?v=${row.avatar_updated_at?.getTime() ?? 0}`
      : null,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at
  };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltValue, hashValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64");
  const actual = (await scryptAsync(password, Buffer.from(saltValue, "base64"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  request: Request,
  response: Response
) {
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO sessions (token_hash, user_id, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hash, userId, request.get("user-agent")?.slice(0, 300), request.ip, expiresAt]
  );
  if (config.isProduction) {
    response.clearCookie(LEGACY_SESSION_COOKIE, { path: "/", secure: true });
  }
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookies,
    path: "/",
    priority: "high",
    expires: expiresAt
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookies,
    path: "/"
  });
}

export function readSessionToken(cookieHeader?: string) {
  if (!cookieHeader) return null;
  return parseCookie(cookieHeader)[SESSION_COOKIE] ?? null;
}

export async function userFromToken(token: string | null): Promise<(AuthUser & { sessionHash: string }) | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const result = await query<UserRow>(
    `SELECT u.id, u.email, u.username, u.display_name, u.bio, u.avatar_color,
            u.avatar_storage_name, u.avatar_updated_at,
            u.last_seen_at, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash]
  );
  const row = result.rows[0];
  return row ? { ...publicUser(row), sessionHash: hash } : null;
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  try {
    const session = await userFromToken(readSessionToken(request.headers.cookie));
    if (!session) {
      response.status(401).json({ error: "Нужно войти в аккаунт" });
      return;
    }
    const authenticated = request as AuthenticatedRequest;
    authenticated.user = session;
    authenticated.sessionHash = session.sessionHash;
    next();
  } catch (error) {
    next(error);
  }
}
