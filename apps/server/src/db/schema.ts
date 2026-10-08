import { boolean, date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  clientName: text().notNull(),
  clientEmail: text().notNull(),
  currency: text().notNull().default("USD"),
  total: numeric({ precision: 12, scale: 2 }).notNull(),
  startDate: date().notNull(),
  contractText: text(),
  agentCheckedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const phases = pgTable("phases", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  name: text().notNull(),
  startDate: date().notNull(),
  endDate: date().notNull(),
  waitForPayment: boolean().notNull().default(false),
  // Dates from the original plan, kept so the Gantt can show how far a phase has moved.
  baselineStart: date(),
  baselineEnd: date(),
  // planned | active | blocked | done
  status: text().notNull().default("planned"),
});

export const milestones = pgTable("milestones", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  phaseId: uuid().references(() => phases.id, { onDelete: "set null" }),
  label: text().notNull(),
  amount: numeric({ precision: 12, scale: 2 }).notNull(),
  dueDate: date(),
  paypalInvoiceId: text().unique(),
  // Link the client opens to pay; set once the invoice is sent.
  payerUrl: text(),
  amountPaid: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
  // Capture ids of the payments on this invoice, used to match disputes back to it.
  transactionIds: text().array().notNull().default([]),
  // False for the second half of a split invoice, so paying the first half is enough to move on.
  holdsNextPhase: boolean().notNull().default(true),
  // pending | sent | paid | partially_paid | refunded | cancelled
  status: text().notNull().default("pending"),
});

export const payouts = pgTable("payouts", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  phaseId: uuid().references(() => phases.id, { onDelete: "set null" }),
  name: text().notNull(),
  email: text(),
  amount: numeric({ precision: 12, scale: 2 }).notNull(),
  trigger: text().notNull(),
  paypalBatchId: text(),
  // pending | sent | success | failed | unclaimed
  status: text().notNull().default("pending"),
});

// Every webhook we get, keyed by PayPal's event id so retries are ignored.
export const paypalEvents = pgTable("paypal_events", {
  id: text().primaryKey(),
  eventType: text().notNull(),
  resourceId: text(),
  payload: jsonb().notNull(),
  verified: boolean().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Plain-English log of what happened on a project, newest first in the UI.
export const activity = pgTable("activity", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // info | payment | warning | agent
  kind: text().notNull().default("info"),
  message: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Things the agent wants to do. Nothing reaches the client or PayPal until the user approves.
export const suggestions = pgTable("suggestions", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // send_invoice | reminder | partial_payment | replan | payout | pause
  kind: text().notNull(),
  // The milestone, phase or payout the suggestion is about.
  targetId: uuid().notNull(),
  title: text().notNull(),
  reason: text().notNull(),
  // Editable details for the action, e.g. the reminder text or how many days to shift.
  draft: jsonb().notNull().default({}),
  // open | approved | dismissed | failed
  status: text().notNull().default("open"),
  error: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp({ withTimezone: true }),
});
