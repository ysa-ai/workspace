import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, userProcedure } from "./init";
import { db } from "../db";
import {
  users, organizations, orgMembers, sessions, projects, containerPeaks,
  tasks, taskWorkflowStates, stepResults, stepModuleData, stepPrompts,
  workflows, workflowSteps, workflowTransitions,
  toolPresets, orgInvitations, emailChangeTokens, deviceAuthCodes,
} from "../db/schema";
import { sendEmail } from "../lib/email";
import { eq, and, inArray, isNull, gt } from "drizzle-orm";
import { createSessionTokens } from "../lib/auth-helpers";
import { randomBytes } from "crypto";
import { config } from "../config";
import { encrypt, decrypt } from "../lib/crypto";

async function requireAdminRole(orgId: number, userId: number) {
  const [member] = await db.select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.user_id, userId), eq(orgMembers.org_id, orgId)))
    .limit(1);
  if (!member || (member.role !== "owner" && member.role !== "admin"))
    throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can perform this action" });
  return member;
}

export const authRouter = router({
  me: userProcedure.query(async ({ ctx }) => {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      onboarding_step: users.onboarding_step,
      onboarding_completed_at: users.onboarding_completed_at,
    }).from(users).where(eq(users.id, ctx.userId)).limit(1);
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    const [org] = await db.select({ name: organizations.name })
      .from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    return {
      id: user.id,
      email: user.email,
      orgId: ctx.orgId,
      orgName: org?.name ?? "",
      onboardingStep: user.onboarding_step,
      onboardingCompletedAt: user.onboarding_completed_at,
    };
  }),

  orgs: userProcedure.query(async ({ ctx }) => {
    return db.select({
      id: organizations.id,
      name: organizations.name,
      role: orgMembers.role,
    })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.org_id, organizations.id))
      .where(eq(orgMembers.user_id, ctx.userId));
  }),

  switchOrg: userProcedure
    .input(z.object({ orgId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [membership] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, ctx.userId), eq(orgMembers.org_id, input.orgId)))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      return createSessionTokens(ctx.userId, input.orgId);
    }),

  createOrg: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [taken] = await db.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.name, input.name.trim())).limit(1);
      if (taken) throw new TRPCError({ code: "CONFLICT", message: "An organization with this name already exists" });
      const [org] = await db.insert(organizations)
        .values({ name: input.name.trim() })
        .returning({ id: organizations.id, name: organizations.name });
      await db.insert(orgMembers).values({ user_id: ctx.userId, org_id: org.id, role: "owner" });
      return org;
    }),

  updateOrg: protectedProcedure
    .input(z.object({ orgId: z.number(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [member] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, ctx.userId), eq(orgMembers.org_id, input.orgId)))
        .limit(1);
      if (!member || member.role !== "owner")
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can update organization settings" });
      const [taken] = await db.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.name, input.name.trim())).limit(1);
      if (taken && taken.id !== input.orgId)
        throw new TRPCError({ code: "CONFLICT", message: "An organization with this name already exists" });
      await db.update(organizations).set({ name: input.name.trim() }).where(eq(organizations.id, input.orgId));
      return { ok: true };
    }),

  deleteOrg: protectedProcedure
    .input(z.object({ orgId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [member] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, ctx.userId), eq(orgMembers.org_id, input.orgId)))
        .limit(1);
      if (!member || member.role !== "owner")
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can delete an organization" });

      const orgProjects = await db.select({ project_id: projects.project_id })
        .from(projects).where(eq(projects.org_id, input.orgId));
      const projectIds = orgProjects.map((p) => p.project_id);

      if (projectIds.length > 0) {
        const orgTasks = await db.select({ task_id: tasks.task_id })
          .from(tasks).where(inArray(tasks.project_id, projectIds));
        const taskIds = orgTasks.map((i) => i.task_id);

        if (taskIds.length > 0) {
          await db.delete(taskWorkflowStates).where(inArray(taskWorkflowStates.task_id, taskIds));
          await db.delete(stepResults).where(inArray(stepResults.task_id, taskIds));
          await db.delete(stepModuleData).where(inArray(stepModuleData.task_id, taskIds));
          await db.delete(stepPrompts).where(inArray(stepPrompts.task_id, taskIds));
          await db.delete(tasks).where(inArray(tasks.task_id, taskIds));
        }

        for (const pid of projectIds) {
          await db.delete(containerPeaks).where(eq(containerPeaks.project_id, pid));
        }
        await db.delete(projects).where(eq(projects.org_id, input.orgId));
      }

      const orgWorkflows = await db.select({ id: workflows.id })
        .from(workflows).where(eq(workflows.org_id, input.orgId));
      if (orgWorkflows.length > 0) {
        const wfIds = orgWorkflows.map((w) => w.id);
        const steps = await db.select({ id: workflowSteps.id })
          .from(workflowSteps).where(inArray(workflowSteps.workflow_id, wfIds));
        if (steps.length > 0) {
          await db.delete(workflowTransitions).where(inArray(workflowTransitions.from_step_id, steps.map((s) => s.id)));
          await db.delete(workflowSteps).where(inArray(workflowSteps.workflow_id, wfIds));
        }
        await db.delete(workflows).where(eq(workflows.org_id, input.orgId));
      }

      await db.delete(toolPresets).where(eq(toolPresets.org_id, input.orgId));
      await db.delete(orgInvitations).where(eq(orgInvitations.org_id, input.orgId));
      await db.delete(sessions).where(eq(sessions.org_id, input.orgId));
      await db.delete(orgMembers).where(eq(orgMembers.org_id, input.orgId));
      await db.delete(organizations).where(eq(organizations.id, input.orgId));
      return { ok: true };
    }),

  listMembers: protectedProcedure.query(async ({ ctx }) => {
    return db.select({ userId: users.id, email: users.email, role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.user_id, users.id))
      .where(eq(orgMembers.org_id, ctx.orgId));
  }),

  inviteMember: protectedProcedure
    .input(z.object({ role: z.literal("member").default("member") }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminRole(ctx.orgId, ctx.userId);
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await db.insert(orgInvitations).values({
        org_id: ctx.orgId,
        role: input.role,
        token,
        invited_by: ctx.userId,
        expires_at: expiresAt,
      });
      const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
      return { token, url: `${appUrl}/invite/${token}` };
    }),

  listInvites: protectedProcedure.query(async ({ ctx }) => {
    await requireAdminRole(ctx.orgId, ctx.userId);
    return db.select({
      id: orgInvitations.id,
      role: orgInvitations.role,
      token: orgInvitations.token,
      created_at: orgInvitations.created_at,
      expires_at: orgInvitations.expires_at,
    })
      .from(orgInvitations)
      .where(and(
        eq(orgInvitations.org_id, ctx.orgId),
        isNull(orgInvitations.used_at),
        gt(orgInvitations.expires_at, new Date().toISOString()),
      ));
  }),

  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminRole(ctx.orgId, ctx.userId);
      const [invite] = await db.select({ id: orgInvitations.id })
        .from(orgInvitations)
        .where(and(eq(orgInvitations.id, input.inviteId), eq(orgInvitations.org_id, ctx.orgId)))
        .limit(1);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      await db.delete(orgInvitations).where(eq(orgInvitations.id, input.inviteId));
      return { ok: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminRole(ctx.orgId, ctx.userId);
      const [target] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, input.userId), eq(orgMembers.org_id, ctx.orgId)))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (target.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove the owner" });
      await db.delete(orgMembers).where(and(eq(orgMembers.org_id, ctx.orgId), eq(orgMembers.user_id, input.userId)));
      return { ok: true };
    }),

  updateMemberRole: protectedProcedure
    .input(z.object({ userId: z.number(), role: z.enum(["admin", "member"]) }))
    .mutation(async ({ ctx, input }) => {
      const [caller] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, ctx.userId), eq(orgMembers.org_id, ctx.orgId)))
        .limit(1);
      if (!caller || caller.role !== "owner")
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can change member roles" });
      if (input.userId === ctx.userId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role" });
      await db.update(orgMembers)
        .set({ role: input.role })
        .where(and(eq(orgMembers.org_id, ctx.orgId), eq(orgMembers.user_id, input.userId)));
      return { ok: true };
    }),

  forcePasswordReset: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [caller] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, ctx.userId), eq(orgMembers.org_id, ctx.orgId)))
        .limit(1);
      if (!caller || caller.role !== "owner")
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can force a password reset" });
      if (input.userId === ctx.userId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot force reset your own password" });
      const [target] = await db.select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, input.userId), eq(orgMembers.org_id, ctx.orgId)))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (target.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Cannot reset the owner's password" });
      await db.update(users).set({ force_password_reset: true }).where(eq(users.id, input.userId));
      await db.delete(sessions).where(eq(sessions.user_id, input.userId));
      return { ok: true };
    }),

  validateInvite: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const [invite] = await db.select({
        id: orgInvitations.id,
        org_id: orgInvitations.org_id,
        role: orgInvitations.role,
        expires_at: orgInvitations.expires_at,
        used_at: orgInvitations.used_at,
      })
        .from(orgInvitations)
        .where(eq(orgInvitations.token, input.token))
        .limit(1);
      if (!invite) return { valid: false, expired: false, used: false, orgName: "", role: "" };
      const [org] = await db.select({ name: organizations.name })
        .from(organizations).where(eq(organizations.id, invite.org_id)).limit(1);
      const expired = new Date(invite.expires_at) < new Date();
      const used = !!invite.used_at;
      return {
        valid: !expired && !used,
        expired,
        used,
        orgName: org?.name ?? "",
        role: invite.role,
      };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [invite] = await db.select({
        id: orgInvitations.id,
        org_id: orgInvitations.org_id,
        role: orgInvitations.role,
        expires_at: orgInvitations.expires_at,
        used_at: orgInvitations.used_at,
      })
        .from(orgInvitations)
        .where(and(
          eq(orgInvitations.token, input.token),
          isNull(orgInvitations.used_at),
          gt(orgInvitations.expires_at, new Date().toISOString()),
        ))
        .limit(1);
      if (!invite) throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired or already been used" });

      const [existing] = await db.select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.user_id, ctx.userId), eq(orgMembers.org_id, invite.org_id)))
        .limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "You are already a member of this organization" });

      await db.insert(orgMembers).values({ user_id: ctx.userId, org_id: invite.org_id, role: invite.role });
      await db.update(orgInvitations)
        .set({ used_at: new Date().toISOString() })
        .where(eq(orgInvitations.id, invite.id));
      return { orgId: invite.org_id };
    }),

  deleteAccount: userProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.userId;

    // Find orgs where this user is the sole owner
    const memberships = await db.select({ org_id: orgMembers.org_id, role: orgMembers.role })
      .from(orgMembers).where(eq(orgMembers.user_id, userId));

    for (const m of memberships) {
      if (m.role !== "owner") continue;
      const owners = await db.select({ user_id: orgMembers.user_id })
        .from(orgMembers)
        .where(and(eq(orgMembers.org_id, m.org_id), eq(orgMembers.role, "owner")));
      if (owners.length > 1) continue;

      // Sole owner — delete all org data
      const orgId = m.org_id;
      const orgProjects = await db.select({ project_id: projects.project_id })
        .from(projects).where(eq(projects.org_id, orgId));
      const projectIds = orgProjects.map((p) => p.project_id);

      if (projectIds.length > 0) {
        const orgTasks = await db.select({ task_id: tasks.task_id })
          .from(tasks).where(inArray(tasks.project_id, projectIds));
        const taskIds = orgTasks.map((i) => i.task_id);

        if (taskIds.length > 0) {
          await db.delete(taskWorkflowStates).where(inArray(taskWorkflowStates.task_id, taskIds));
          await db.delete(stepResults).where(inArray(stepResults.task_id, taskIds));
          await db.delete(stepModuleData).where(inArray(stepModuleData.task_id, taskIds));
          await db.delete(stepPrompts).where(inArray(stepPrompts.task_id, taskIds));
          await db.delete(tasks).where(inArray(tasks.task_id, taskIds));
        }

        for (const pid of projectIds) {
          await db.delete(containerPeaks).where(eq(containerPeaks.project_id, pid));
        }
        await db.delete(projects).where(eq(projects.org_id, orgId));
      }

      const orgWorkflows = await db.select({ id: workflows.id })
        .from(workflows).where(eq(workflows.org_id, orgId));
      if (orgWorkflows.length > 0) {
        const wfIds = orgWorkflows.map((w) => w.id);
        const steps = await db.select({ id: workflowSteps.id })
          .from(workflowSteps).where(inArray(workflowSteps.workflow_id, wfIds));
        if (steps.length > 0) {
          await db.delete(workflowTransitions).where(inArray(workflowTransitions.from_step_id, steps.map((s) => s.id)));
          await db.delete(workflowSteps).where(inArray(workflowSteps.workflow_id, wfIds));
        }
        await db.delete(workflows).where(eq(workflows.org_id, orgId));
      }

      await db.delete(toolPresets).where(eq(toolPresets.org_id, orgId));
      await db.delete(orgInvitations).where(eq(orgInvitations.org_id, orgId));
      await db.delete(sessions).where(eq(sessions.org_id, orgId));
      await db.delete(orgMembers).where(eq(orgMembers.org_id, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }

    // Remove from any remaining orgs
    await db.delete(orgMembers).where(eq(orgMembers.user_id, userId));
    // Null out non-cascading FK references
    await db.update(tasks).set({ created_by: null }).where(eq(tasks.created_by, userId));
    await db.update(orgInvitations).set({ invited_by: null }).where(eq(orgInvitations.invited_by, userId));
    await db.delete(deviceAuthCodes).where(eq(deviceAuthCodes.user_id, userId));
    await db.delete(users).where(eq(users.id, userId));
    return { ok: true };
  }),

  getProjectToken: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const [row] = await db.select({ issue_source_token: projects.issue_source_token })
        .from(projects).where(eq(projects.project_id, input.projectId)).limit(1);
      return { has_token: !!(row?.issue_source_token) };
    }),

  updateProjectToken: protectedProcedure
    .input(z.object({ projectId: z.string(), token: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdminRole(ctx.orgId, ctx.userId);
      const value = input.token ? encrypt(input.token, config.masterKey) : null;
      await db.update(projects).set({ issue_source_token: value }).where(eq(projects.project_id, input.projectId));
      return { ok: true };
    }),

  changePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.newPassword.length < 8)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Password must be at least 8 characters" });
      if (!/\d/.test(input.newPassword))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Password must contain at least one number" });

      const [user] = await db.select({ password_hash: users.password_hash })
        .from(users).where(eq(users.id, ctx.userId)).limit(1);
      if (!user || !user.password_hash) throw new TRPCError({ code: "UNAUTHORIZED" });

      const valid = await Bun.password.verify(input.currentPassword, user.password_hash);
      if (!valid) throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect" });

      const password_hash = await Bun.password.hash(input.newPassword);
      await db.update(users).set({ password_hash }).where(eq(users.id, ctx.userId));
      await db.delete(sessions).where(and(eq(sessions.user_id, ctx.userId), eq(sessions.org_id, ctx.orgId)));
      return { ok: true };
    }),

  updateOnboardingStep: userProcedure
    .input(z.object({ step: z.number().int().min(0).max(4) }))
    .mutation(async ({ ctx, input }) => {
      await db.update(users).set({ onboarding_step: input.step, onboarding_completed_at: null }).where(eq(users.id, ctx.userId));
      return { ok: true };
    }),

  resetOnboarding: userProcedure
    .mutation(async ({ ctx }) => {
      await db.update(users)
        .set({ onboarding_step: 0, onboarding_completed_at: null })
        .where(eq(users.id, ctx.userId));
      return { ok: true };
    }),

  completeOnboarding: userProcedure
    .mutation(async ({ ctx }) => {
      await db.update(users)
        .set({ onboarding_completed_at: new Date().toISOString() })
        .where(eq(users.id, ctx.userId));
      return { ok: true };
    }),

  updateOnboardingProfile: userProcedure
    .input(z.object({
      role: z.string().optional(),
      teamSize: z.string().optional(),
      useCase: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.update(users).set({
        onboarding_role: input.role ?? null,
        onboarding_team_size: input.teamSize ?? null,
        onboarding_use_case: input.useCase ?? null,
      }).where(eq(users.id, ctx.userId));
      return { ok: true };
    }),

  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: z.string().email(), currentPassword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await db.select({ email: users.email, password_hash: users.password_hash })
        .from(users).where(eq(users.id, ctx.userId)).limit(1);
      if (!user || !user.password_hash) throw new TRPCError({ code: "UNAUTHORIZED" });

      const valid = await Bun.password.verify(input.currentPassword, user.password_hash);
      if (!valid) throw new TRPCError({ code: "BAD_REQUEST", message: "Current password is incorrect" });

      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.newEmail)).limit(1);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });

      const token = randomBytes(32).toString("hex");
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await db.delete(emailChangeTokens).where(eq(emailChangeTokens.user_id, ctx.userId));
      await db.insert(emailChangeTokens).values({ user_id: ctx.userId, new_email: input.newEmail, token_hash: tokenHash, expires_at });

      const origin = config.origin;
      const verifyUrl = `${origin}/app/auth/verify-email-change?token=${token}`;
      sendEmail(input.newEmail, "Confirm your new ysa email", `<p>Click the link below to confirm your new email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 1 hour.</p>`).catch(() => {});

      return { ok: true };
    }),
});
