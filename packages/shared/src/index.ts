import { z } from "zod";

// What the model pulls out of a contract. Dates and money math happen in code, not in the model.
export const ContractExtract = z.object({
  client: z.object({ name: z.string(), email: z.email() }),
  currency: z.string().length(3),
  total: z.number().positive(),
  startDate: z.iso.date(),
  phases: z.array(
    z.object({
      name: z.string(),
      durationDays: z.number().int().positive(),
      dependsOnPrevious: z.boolean(),
      waitForPayment: z.boolean().describe("Phase can't start until the previous milestone is paid"),
    }),
  ),
  milestones: z.array(
    z.object({
      phaseIndex: z.number().int().nonnegative(),
      percent: z.number().positive().max(100),
      trigger: z.string(),
    }),
  ),
  payouts: z.array(
    z.object({
      name: z.string(),
      email: z.email().optional(),
      amount: z.number().positive(),
      phaseIndex: z.number().int().nonnegative(),
      trigger: z.string(),
    }),
  ),
});
export type ContractExtract = z.infer<typeof ContractExtract>;

// Pushed to the browser over SSE so the Gantt updates live.
export type ServerEvent =
  | { type: "hello" }
  | { type: "paypal"; eventType: string; resourceId: string | null; at: string };
