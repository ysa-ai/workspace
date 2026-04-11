import { router } from "./init";
import { authRouter } from "./auth";
import { tasksRouter } from "./tasks";
import { actionsRouter } from "./actions";
import { systemRouter } from "./system";
import { projectsRouter } from "./projects";
import { workflowsRouter, toolPresetsRouter } from "./workflows";

export const appRouter = router({
  auth: authRouter,
  tasks: tasksRouter,
  actions: actionsRouter,
  system: systemRouter,
  projects: projectsRouter,
  workflows: workflowsRouter,
  toolPresets: toolPresetsRouter,
});

export type AppRouter = typeof appRouter;
