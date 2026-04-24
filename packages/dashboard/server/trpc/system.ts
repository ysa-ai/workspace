import { z } from "zod";
import { router, protectedProcedure as publicProcedure, protectedProcedure } from "./init";
import { getResourceMetrics } from "../lib/resources";
import { getBuildState, clearBuildState } from "../lib/build-manager";
import { isAgentConnected, getAgentUserId } from "../ws/handler";
import { sendCommand } from "../ws/dispatch";

export type DetectedTerminal = {
  id: string;
  name: string;
};

export const systemRouter = router({
  resources: publicProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(async ({ input }) => getResourceMetrics(input?.projectId)),
  detectTerminals: publicProcedure.query(async () => {
    const ack = await sendCommand("detectTerminals", {}, 5000).catch(() => ({ ok: false, data: undefined }));
    return (ack.ok && Array.isArray((ack as any).data)) ? (ack as any).data as DetectedTerminal[] : [];
  }),
  buildStatus: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }) => getBuildState(input.projectId)),
  clearBuildStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ input }) => { clearBuildState(input.projectId); return { ok: true }; }),
  agentConnected: protectedProcedure
    .query(({ ctx }) => isAgentConnected() && getAgentUserId() === ctx.userId),
  pickDirectory: protectedProcedure
    .mutation(async () => {
      const ack = await sendCommand("pickDirectory", {}, 60000);
      if (!ack.ok) throw new Error(ack.error ?? "pickDirectory failed");
      return { path: (ack.data as any)?.path as string };
    }),
  cloneSandbox: protectedProcedure
    .input(z.object({ directory: z.string().min(1), repoUrl: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const ack = await sendCommand("cloneSandbox", { directory: input.directory, repoUrl: input.repoUrl }, 120000);
      if (!ack.ok) throw new Error(ack.error ?? "Clone failed");
      return { ok: true };
    }),
});
