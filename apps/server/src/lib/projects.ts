import type { MilestoneStatus, PayoutStatus, PhaseStatus, PlanDraft, ProjectDetail } from "@milestone/shared";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";

export async function saveProject(plan: PlanDraft, contractText: string | null): Promise<string> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(schema.projects)
      .values({
        name: plan.projectName,
        clientName: plan.client.name,
        clientEmail: plan.client.email,
        currency: plan.currency,
        total: String(plan.total),
        startDate: plan.startDate,
        contractText,
      })
      .returning({ id: schema.projects.id });
    const projectId = project!.id;

    const phaseRows = await tx
      .insert(schema.phases)
      .values(
        plan.phases.map((p, i) => ({
          projectId,
          position: i,
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          waitForPayment: p.waitForPayment,
          // A phase that waits on money starts blocked; a paid invoice unblocks it.
          status: p.waitForPayment ? "blocked" : "planned",
        })),
      )
      .returning({ id: schema.phases.id, position: schema.phases.position });
    const phaseId = (index: number) => phaseRows.find((r) => r.position === index)?.id ?? null;

    if (plan.milestones.length > 0) {
      await tx.insert(schema.milestones).values(
        plan.milestones.map((m) => ({
          projectId,
          phaseId: phaseId(m.phaseIndex),
          label: m.label,
          amount: String(m.amount),
          dueDate: m.dueDate,
        })),
      );
    }
    if (plan.payouts.length > 0) {
      await tx.insert(schema.payouts).values(
        plan.payouts.map((p) => ({
          projectId,
          phaseId: phaseId(p.phaseIndex),
          name: p.name,
          email: p.email,
          amount: String(p.amount),
          trigger: p.trigger,
        })),
      );
    }
    return projectId;
  });
}

export async function listProjects() {
  return db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      clientName: schema.projects.clientName,
      currency: schema.projects.currency,
      total: schema.projects.total,
      startDate: schema.projects.startDate,
    })
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt))
    .then((rows) => rows.map((r) => ({ ...r, total: Number(r.total) })));
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
  if (!project) return null;
  const [phases, milestones, payouts] = await Promise.all([
    db.select().from(schema.phases).where(eq(schema.phases.projectId, id)).orderBy(asc(schema.phases.position)),
    db.select().from(schema.milestones).where(eq(schema.milestones.projectId, id)).orderBy(asc(schema.milestones.dueDate)),
    db.select().from(schema.payouts).where(eq(schema.payouts.projectId, id)),
  ]);
  return {
    id: project.id,
    name: project.name,
    clientName: project.clientName,
    clientEmail: project.clientEmail,
    currency: project.currency,
    total: Number(project.total),
    startDate: project.startDate,
    phases: phases.map((p) => ({
      id: p.id,
      position: p.position,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      waitForPayment: p.waitForPayment,
      status: p.status as PhaseStatus,
    })),
    milestones: milestones.map((m) => ({
      id: m.id,
      phaseId: m.phaseId,
      label: m.label,
      amount: Number(m.amount),
      dueDate: m.dueDate,
      status: m.status as MilestoneStatus,
      paypalInvoiceId: m.paypalInvoiceId,
      payerUrl: m.payerUrl,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      phaseId: p.phaseId,
      name: p.name,
      email: p.email,
      amount: Number(p.amount),
      trigger: p.trigger,
      status: p.status as PayoutStatus,
      paypalBatchId: p.paypalBatchId,
    })),
  };
}
