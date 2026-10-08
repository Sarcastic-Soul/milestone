import type { PlanDraft, SuggestionDraft } from "@milestone/shared";
import { Hono } from "hono";
import { checkProject } from "../lib/agent.ts";
import { extractContract } from "../lib/extract.ts";
import { sendMilestoneInvoice } from "../lib/invoices.ts";
import { buildPlan } from "../lib/plan.ts";
import { getProject, listProjects, saveProject } from "../lib/projects.ts";
import { approveSuggestion, dismissSuggestion, SuggestionError } from "../lib/suggestions.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export const projects = new Hono()
  .get("/", async (c) => c.json(await listProjects()))

  // Step 1: read a contract (pasted text, PDF or photo) and return a draft plan to review.
  .post("/draft", async (c) => {
    const form = await c.req.parseBody();
    const text = typeof form.text === "string" ? form.text : undefined;
    const upload = form.file instanceof File ? form.file : undefined;
    if (upload && (upload.size > MAX_FILE_BYTES || !FILE_TYPES.includes(upload.type))) {
      return c.json({ error: "Upload a PDF, PNG, JPEG or WebP under 10 MB." }, 400);
    }
    const file = upload ? { data: new Uint8Array(await upload.arrayBuffer()), mediaType: upload.type } : undefined;
    if (!text?.trim() && !file) return c.json({ error: "Paste the contract or upload a file." }, 400);

    const { extract, contractText } = await extractContract({ text, file });
    return c.json({ plan: buildPlan(extract), contractText });
  })

  // Step 2: save the reviewed plan.
  .post("/", async (c) => {
    const body = await c.req.json<{ plan: PlanDraft; contractText?: string | null }>();
    const id = await saveProject(body.plan, body.contractText ?? null);
    void checkProject(id);
    return c.json({ id }, 201);
  })

  .get("/:id", async (c) => {
    const project = await getProject(c.req.param("id"));
    return project ? c.json(project) : c.json({ error: "Not found" }, 404);
  })

  .post("/:id/milestones/:milestoneId/invoice", async (c) => {
    const result = await sendMilestoneInvoice(c.req.param("milestoneId"));
    return c.json(result);
  })

  // Ask the agent to look at the project now instead of waiting for the next scheduled check.
  .post("/:id/agent/check", async (c) => {
    void checkProject(c.req.param("id"));
    return c.json({ queued: true }, 202);
  })

  .post("/:id/suggestions/:sid/approve", async (c) => {
    const body = await c.req.json<{ draft?: SuggestionDraft }>().catch(() => ({}) as { draft?: SuggestionDraft });
    try {
      await approveSuggestion(c.req.param("sid"), body.draft);
    } catch (err) {
      return c.json({ error: (err as Error).message }, err instanceof SuggestionError ? 409 : 502);
    }
    return c.json({ ok: true });
  })

  .post("/:id/suggestions/:sid/dismiss", async (c) => {
    await dismissSuggestion(c.req.param("sid"));
    return c.json({ ok: true });
  });
