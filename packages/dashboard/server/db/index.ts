import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { config } from "../config";
import * as schema from "./schema";

const client = postgres(config.databaseUrl, { prepare: false, onnotice: () => {} });
export const db = drizzle(client, { schema });
