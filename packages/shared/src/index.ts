import { z } from "zod";

// What the model pulls out of a contract. Dates and money math happen in code, not in the model.
export const ContractExtract = z.object({
  projectName: z.string().describe("Short project name, e.g. 'Brightleaf website redesign'"),
  client: z.object({ name: z.string(), email: z.email() }),
  currency: z.string().length(3).describe("ISO 4217 code, e.g. USD"),
  total: z.number().positive().describe("Total contract fee"),
  startDate: z.iso.date().describe("Project start date, YYYY-MM-DD"),
  phases: z
    .array(
      z.object({
        name: z.string(),
        durationDays: z.number().int().positive().describe("Calendar days; 1 week = 7"),
        waitForPayment: z
          .boolean()
          .describe("True only if the contract says this phase starts after the previous payment clears"),
      }),
    )
    .min(1)
    .describe("In order; each phase starts when the previous one ends"),
  milestones: z
    .array(
      z.object({
        phaseIndex: z.number().int().nonnegative().describe("0-based index into phases"),
        due: z.enum(["phase_start", "phase_end"]).describe("phase_start for deposits due at signing/kickoff"),
        percent: z.number().positive().max(100).describe("Share of the total fee"),
        label: z.string().describe("Short name, e.g. 'Deposit' or 'Design approval'"),
      }),
    )
    .describe("Payments the CLIENT owes the freelancer"),
  payouts: z
    .array(
      z.object({
        name: z.string(),
        email: z.email().nullable(),
        amount: z.number().positive(),
        phaseIndex: z.number().int().nonnegative(),
        trigger: z.string(),
      }),
    )
    .describe("Payments the freelancer owes SUBCONTRACTORS. Never put client payments here."),
});
export type ContractExtract = z.infer<typeof ContractExtract>;

export type PhaseStatus = "planned" | "active" | "blocked" | "done";
export type MilestoneStatus = "pending" | "sent" | "paid" | "partially_paid" | "refunded" | "cancelled";
export type PayoutStatus = "pending" | "sent" | "success" | "failed";
export type ActivityKind = "info" | "payment" | "warning" | "agent";

// A plan ready to show or save: concrete dates and amounts, computed in code.
export type PlanDraft = {
  projectName: string;
  client: { name: string; email: string };
  currency: string;
  total: number;
  startDate: string;
  phases: { name: string; startDate: string; endDate: string; waitForPayment: boolean }[];
  milestones: { phaseIndex: number; label: string; amount: number; dueDate: string }[];
  payouts: { phaseIndex: number; name: string; email: string | null; amount: number; trigger: string }[];
  warnings: string[];
};

export type ProjectDetail = {
  id: string;
  name: string;
  clientName: string;
  clientEmail: string;
  currency: string;
  total: number;
  startDate: string;
  phases: { id: string; position: number; name: string; startDate: string; endDate: string; waitForPayment: boolean; status: PhaseStatus }[];
  milestones: { id: string; phaseId: string | null; label: string; amount: number; dueDate: string | null; status: MilestoneStatus; paypalInvoiceId: string | null; payerUrl: string | null }[];
  payouts: { id: string; phaseId: string | null; name: string; email: string | null; amount: number; trigger: string; status: PayoutStatus; paypalBatchId: string | null }[];
  activity: { id: string; kind: ActivityKind; message: string; at: string }[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  clientName: string;
  currency: string;
  total: number;
  startDate: string;
  endDate: string | null;
  collected: number;
  // Sent invoices past their due date and still unpaid.
  overdue: number;
  blockedPhases: number;
};

// Pushed to the browser over SSE so the Gantt updates live.
export type ServerEvent =
  | { type: "hello" }
  | { type: "paypal"; eventType: string; resourceId: string | null; at: string }
  | { type: "project"; projectId: string; reason: string };
