import { ApiError, Client, Environment, PaymentsController } from "@paypal/paypal-server-sdk";
import { env } from "../env.ts";
import { type CaptureBreakdown, type Fees, totalFees } from "./fees.ts";

// The PayPal Server SDK covers Payments but not Invoicing, so invoices go through REST in
// paypal.ts and the captures behind a paid invoice come through here.
const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: env.PAYPAL_CLIENT_ID,
    oAuthClientSecret: env.PAYPAL_SECRET,
  },
  environment: env.PAYPAL_ENVIRONMENT === "LIVE" ? Environment.Production : Environment.Sandbox,
  timeout: 15_000,
});
const payments = new PaymentsController(client);

// Reads each capture and returns the PayPal fee and the amount that reached the seller.
// A capture PayPal can't find is skipped rather than failing the whole invoice sync.
export async function readFees(captureIds: string[]): Promise<Fees | null> {
  const captures: CaptureBreakdown[] = [];
  for (const captureId of captureIds) {
    try {
      const { result } = await payments.getCapturedPayment({ captureId });
      captures.push(result);
    } catch (err) {
      const status = err instanceof ApiError ? err.statusCode : "network";
      console.warn(`[captures] could not read ${captureId} (${status})`);
    }
  }
  return totalFees(captures);
}
