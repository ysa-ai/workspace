// @ts-ignore
const buildUrl: string | undefined = typeof __DASHBOARD_URL__ !== "undefined" ? __DASHBOARD_URL__ : undefined;
export const DASHBOARD_URL = buildUrl ?? process.env.YSA_URL ?? "http://localhost:3333";
