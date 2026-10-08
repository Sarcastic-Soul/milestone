import type { ActivityKind } from "@milestone/shared";
import { db, schema } from "../db/index.ts";
import { publish } from "./events.ts";

// Writes one line to the project's activity log and tells open browsers to refresh.
export async function logActivity(projectId: string, message: string, kind: ActivityKind = "info") {
  await db.insert(schema.activity).values({ projectId, kind, message });
  publish({ type: "project", projectId, reason: message });
}
