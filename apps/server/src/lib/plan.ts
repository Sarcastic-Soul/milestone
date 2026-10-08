import type { ContractExtract, PlanDraft } from "@milestone/shared";
import { addDays } from "./dates.ts";

const cents = (n: number) => Math.round(n * 100) / 100;

// Turns what the model read into real dates and amounts. The model never does arithmetic.
export function buildPlan(x: ContractExtract): PlanDraft {
  const warnings: string[] = [];

  let cursor = x.startDate;
  const phases = x.phases.map((p) => {
    const startDate = cursor;
    // End dates are exclusive (the day after the last working day), same as Bryntum.
    const endDate = addDays(startDate, p.durationDays);
    cursor = endDate;
    return { name: p.name, startDate, endDate, waitForPayment: p.waitForPayment };
  });

  const validMilestones = x.milestones.filter((m) => {
    if (m.phaseIndex < phases.length) return true;
    warnings.push(`Dropped milestone "${m.label}": it points at a phase that doesn't exist.`);
    return false;
  });

  const percentSum = validMilestones.reduce((sum, m) => sum + m.percent, 0);
  if (Math.abs(percentSum - 100) > 0.01) {
    warnings.push(`Milestones add up to ${percentSum}% of the fee, not 100%.`);
  }

  // Split the total by percent; the last milestone takes any rounding left over.
  let allocated = 0;
  const milestones = validMilestones.map((m, i) => {
    const phase = phases[m.phaseIndex]!;
    const isLast = i === validMilestones.length - 1 && Math.abs(percentSum - 100) <= 0.01;
    const amount = isLast ? cents(x.total - allocated) : cents((x.total * m.percent) / 100);
    allocated = cents(allocated + amount);
    return {
      phaseIndex: m.phaseIndex,
      label: m.label,
      amount,
      dueDate: m.due === "phase_start" ? phase.startDate : phase.endDate,
    };
  });

  const payouts = x.payouts.flatMap((p) => {
    if (p.phaseIndex < phases.length) return [{ ...p, amount: cents(p.amount) }];
    warnings.push(`Dropped payout to ${p.name}: it points at a phase that doesn't exist.`);
    return [];
  });

  return {
    projectName: x.projectName,
    client: x.client,
    currency: x.currency.toUpperCase(),
    total: cents(x.total),
    startDate: x.startDate,
    phases,
    milestones,
    payouts,
    warnings,
  };
}
