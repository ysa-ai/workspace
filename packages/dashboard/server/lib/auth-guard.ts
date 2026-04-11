import { TRPCError } from "@trpc/server";
import { db } from "../db";
import { projects, tasks, workflows, orgMembers } from "../db/schema";
import { eq, and, or, isNull } from "drizzle-orm";

export async function requireProjectAccess(orgId: number, projectId: string): Promise<void> {
  const [row] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.project_id, projectId), eq(projects.org_id, orgId))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
}

export async function requireTaskAccess(orgId: number, taskId: string): Promise<{ createdBy: number | null }> {
  const [row] = await db.select({ id: tasks.id, created_by: tasks.created_by })
    .from(tasks)
    .innerJoin(projects, eq(tasks.project_id, projects.project_id))
    .where(and(eq(tasks.task_id, parseInt(taskId)), eq(projects.org_id, orgId))).limit(1);
  if (row) return { createdBy: row.created_by };

  // Detect tasks have no project — allow access if created_by is a member of this org
  const [detectRow] = await db.select({ created_by: tasks.created_by })
    .from(tasks)
    .innerJoin(orgMembers, and(eq(orgMembers.user_id, tasks.created_by as any), eq(orgMembers.org_id, orgId)))
    .where(and(eq(tasks.task_id, parseInt(taskId)), isNull(tasks.project_id))).limit(1);
  if (!detectRow) throw new TRPCError({ code: "NOT_FOUND" });
  return { createdBy: detectRow.created_by };
}

export async function requireWorkflowAccess(orgId: number, workflowId: number): Promise<{ isBuiltin: boolean }> {
  const [row] = await db.select({ id: workflows.id, is_builtin: workflows.is_builtin }).from(workflows)
    .where(and(eq(workflows.id, workflowId), or(eq(workflows.org_id, orgId), isNull(workflows.org_id)))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return { isBuiltin: row.is_builtin };
}

export async function requireAdminRole(orgId: number, userId: number): Promise<void> {
  const [member] = await db.select({ role: orgMembers.role }).from(orgMembers)
    .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId))).limit(1);
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

export async function requireTaskDeleteAccess(orgId: number, userId: number, taskId: string): Promise<void> {
  const { createdBy } = await requireTaskAccess(orgId, taskId);
  const [member] = await db.select({ role: orgMembers.role }).from(orgMembers)
    .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.user_id, userId))).limit(1);
  if (!member) throw new TRPCError({ code: "FORBIDDEN" });
  if (member.role === "owner" || member.role === "admin") return;
  if (createdBy !== userId) throw new TRPCError({ code: "FORBIDDEN" });
}
