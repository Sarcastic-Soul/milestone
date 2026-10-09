import { env } from "../env.ts";

const PAYPAL_BASE =
  env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

const basicAuth = "Basic " + Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`).toString("base64");

let cached: { token: string; expiresAt: number } | null = null;

// PayPal hands back the same token until it expires, so new app features only show up
// after a fresh one. Pass force=true to revoke and re-mint.
export async function getAccessToken(force = false): Promise<string> {
  if (force && cached) {
    await fetch(`${PAYPAL_BASE}/v1/oauth2/token/terminate`, {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: cached.token, token_type_hint: "ACCESS_TOKEN" }),
    });
    cached = null;
  }
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token;

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

export async function paypal<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`[paypal] ${init.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
    throw new PayPalError(res.status, text);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// Keeps PayPal's own short explanation for the UI; the full body goes to the server log.
class PayPalError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    let detail: { message?: string; details?: { description?: string }[] } = {};
    try {
      detail = JSON.parse(body);
    } catch {}
    const why = detail.details?.[0]?.description ?? detail.message ?? `request failed (${status})`;
    super(`PayPal said: ${why}`);
  }
}

// Splices the raw body in so PayPal checks the exact bytes it signed.
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const body =
    `{"auth_algo":${JSON.stringify(headers.get("paypal-auth-algo"))},` +
    `"cert_url":${JSON.stringify(headers.get("paypal-cert-url"))},` +
    `"transmission_id":${JSON.stringify(headers.get("paypal-transmission-id"))},` +
    `"transmission_sig":${JSON.stringify(headers.get("paypal-transmission-sig"))},` +
    `"transmission_time":${JSON.stringify(headers.get("paypal-transmission-time"))},` +
    `"webhook_id":${JSON.stringify(env.PAYPAL_WEBHOOK_ID)},` +
    `"webhook_event":${rawBody}}`;
  const result = await paypal<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body,
  });
  return result.verification_status === "SUCCESS";
}
