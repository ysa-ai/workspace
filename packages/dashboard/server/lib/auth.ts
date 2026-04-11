import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "crypto";
import { config } from "../config";

const ACCESS_TTL_SECONDS = 8 * 60 * 60; // 8h
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config.authSecret);
}

export interface AccessTokenPayload {
  sub: string;
  orgId: number | null;
  type: "access";
}

export async function signAccessToken(userId: number, orgId: number | null): Promise<string> {
  return new SignJWT({ orgId, type: "access" } as any)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey());
  return payload as unknown as AccessTokenPayload;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TTL_MS);
}
