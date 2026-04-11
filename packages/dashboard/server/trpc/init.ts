import { initTRPC, TRPCError } from "@trpc/server";
import { verifyAccessToken } from "../lib/auth";
import { db } from "../db";
import { orgMembers } from "../db/schema";
import { and, eq } from "drizzle-orm";

export type Context = {
  userId: number;
  orgId: number | null;
} | {
  userId: null;
  orgId: null;
};

export async function createContext({ req }: { req: Request }): Promise<Context> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { userId: null, orgId: null };
  try {
    const payload = await verifyAccessToken(auth.slice(7));
    return { userId: parseInt(payload.sub), orgId: payload.orgId };
  } catch {
    return { userId: null, orgId: null };
  }
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const userProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.userId as number, orgId: ctx.orgId as number } });
});

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const [membership] = await db.select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.user_id, ctx.userId as number), eq(orgMembers.org_id, ctx.orgId as number)))
    .limit(1);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "ORG_ACCESS_REVOKED" });
  return next({ ctx: { userId: ctx.userId as number, orgId: ctx.orgId as number } });
});
