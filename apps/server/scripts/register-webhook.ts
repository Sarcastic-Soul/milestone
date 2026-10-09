// Points a PayPal sandbox webhook at a URL.
// Usage: pnpm webhook:register https://<public-url>
// For a quick tunnel (local dev), old trycloudflare webhooks are removed first, since each run
// gets a new URL, and the ID is saved to the root .env. For a deployed URL the tunnel webhook is
// left alone and the ID is printed, to paste into the host's env vars.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paypal } from "../src/lib/paypal.ts";

const EVENT_TYPES = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
  "INVOICING.INVOICE.UPDATED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
];

const base = process.argv[2]?.replace(/\/$/, "");
if (!base?.startsWith("https://")) {
  console.error("Pass the public https URL of the server.");
  process.exit(1);
}
const target = `${base}/api/webhooks/paypal`;
const isTunnel = target.includes(".trycloudflare.com");

const { webhooks } = await paypal<{ webhooks: { id: string; url: string }[] }>("/v1/notifications/webhooks");
for (const hook of webhooks) {
  if (hook.url === target || (isTunnel && hook.url.includes(".trycloudflare.com"))) {
    await paypal(`/v1/notifications/webhooks/${hook.id}`, { method: "DELETE" });
    console.log(`removed ${hook.url}`);
  }
}

const created = await paypal<{ id: string }>("/v1/notifications/webhooks", {
  method: "POST",
  body: JSON.stringify({ url: target, event_types: EVENT_TYPES.map((name) => ({ name })) }),
});
console.log(`webhook ${created.id} -> ${target}`);

if (!isTunnel) {
  console.log(`set PAYPAL_WEBHOOK_ID=${created.id} on the deployed service`);
  process.exit(0);
}

const envPath = resolve(import.meta.dirname, "../../../.env");
const env = readFileSync(envPath, "utf8");
const line = `PAYPAL_WEBHOOK_ID=${created.id}`;
writeFileSync(envPath, /^PAYPAL_WEBHOOK_ID=.*$/m.test(env) ? env.replace(/^PAYPAL_WEBHOOK_ID=.*$/m, line) : `${env.trimEnd()}\n${line}\n`);
console.log("saved PAYPAL_WEBHOOK_ID to .env (restart the server to pick it up)");
