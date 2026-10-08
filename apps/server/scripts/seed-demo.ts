// Creates a demo project in the middle of its life, with real sandbox invoices:
// the deposit is paid, the design invoice is late, and the build phase is waiting on it.
// Usage: pnpm --filter @milestone/server seed:demo
import type { PlanDraft } from "@milestone/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { addDays, today } from "../src/lib/dates.ts";
import { sendMilestoneInvoice, syncInvoice } from "../src/lib/invoices.ts";
import { paypal } from "../src/lib/paypal.ts";
import { saveProject } from "../src/lib/projects.ts";

const start = addDays(today(), -32);
const phase = (name: string, from: string, days: number, waitForPayment: boolean) => ({
  name,
  startDate: from,
  endDate: addDays(from, days),
  waitForPayment,
});
const discovery = phase("Discovery and content plan", start, 7, false);
const design = phase("Visual design", discovery.endDate, 14, true);
const build = phase("Build and CMS setup", design.endDate, 21, true);
const launch = phase("Launch and training", build.endDate, 7, true);

const plan: PlanDraft = {
  projectName: "Brightleaf Bakery website redesign",
  client: { name: "Maria Lopez", email: "maria@brightleaf.example" },
  currency: "USD",
  total: 8000,
  startDate: start,
  phases: [discovery, design, build, launch],
  milestones: [
    { phaseIndex: 0, label: "Deposit", amount: 2000, dueDate: discovery.startDate },
    { phaseIndex: 1, label: "Design approval", amount: 2000, dueDate: design.endDate },
    { phaseIndex: 2, label: "Site build", amount: 2800, dueDate: build.endDate },
    { phaseIndex: 3, label: "Launch", amount: 1200, dueDate: launch.endDate },
  ],
  payouts: [
    {
      phaseIndex: 0,
      name: "Priya Shah",
      email: "priya@studio.example",
      amount: 400,
      trigger: "When the content plan is signed off",
    },
  ],
  warnings: [],
};

const id = await saveProject(plan, null);
const bills = await db.query.milestones.findMany({ where: eq(schema.milestones.projectId, id) });
const byLabel = (label: string) => bills.find((m) => m.label === label)!;

// Deposit: invoice it, then record it as paid in PayPal so the sync sees a real PAID status.
const deposit = await sendMilestoneInvoice(byLabel("Deposit").id);
await paypal(`/v2/invoicing/invoices/${deposit.invoiceId}/payments`, {
  method: "POST",
  body: JSON.stringify({
    method: "BANK_TRANSFER",
    payment_date: discovery.startDate,
    amount: { currency_code: "USD", value: "2000.00" },
  }),
});
await syncInvoice(deposit.invoiceId);

// Design approval: sent on time, never paid.
await sendMilestoneInvoice(byLabel("Design approval").id);

console.log(`Demo project ready: /p/${id}`);
process.exit(0);
