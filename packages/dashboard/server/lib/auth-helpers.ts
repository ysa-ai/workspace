import { db } from "../db";
import { orgMembers, sessions } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiresAt, signAccessToken } from "./auth";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function createSessionTokens(userId: number, orgId: number | null): Promise<TokenPair> {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = refreshTokenExpiresAt();
  await db.insert(sessions).values({
    user_id: userId,
    org_id: orgId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
  const accessToken = await signAccessToken(userId, orgId);
  return { accessToken, refreshToken };
}

export async function rotateSession(oldTokenHash: string, userId: number, orgId: number): Promise<TokenPair | null> {
  const deleted = await db.delete(sessions)
    .where(eq(sessions.token_hash, oldTokenHash))
    .returning({ id: sessions.id });
  if (deleted.length === 0) return null;
  return createSessionTokens(userId, orgId);
}
