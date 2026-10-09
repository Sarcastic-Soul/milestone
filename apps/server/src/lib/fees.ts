// Kept free of SDK and env imports so it can be tested on its own.

type Amount = { value?: string } | undefined;

export type CaptureBreakdown = {
  status?: string;
  sellerReceivableBreakdown?: { grossAmount?: Amount; paypalFee?: Amount; netAmount?: Amount };
};

export type Fees = { fee: number; net: number };

const cents = (a: Amount) => {
  const n = Number(a?.value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

// Adds up what PayPal kept and what reached the freelancer across the captures behind one
// invoice. Captures without a breakdown (still pending, or declined) are skipped. Returns null
// when none of them has one, so the UI can leave the line out instead of showing $0.
export function totalFees(captures: CaptureBreakdown[]): Fees | null {
  let fee = 0;
  let net = 0;
  let found = false;
  for (const c of captures) {
    const b = c.sellerReceivableBreakdown;
    const gross = cents(b?.grossAmount);
    const paidFee = cents(b?.paypalFee) ?? 0;
    // Net is sometimes missing on older captures; gross minus fee is the same number.
    const paidNet = cents(b?.netAmount) ?? (gross === null ? null : gross - paidFee);
    if (paidNet === null) continue;
    fee += paidFee;
    net += paidNet;
    found = true;
  }
  return found ? { fee: fee / 100, net: net / 100 } : null;
}
