import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { totalFees } from "./fees.ts";

const capture = (gross?: string, fee?: string, net?: string) => ({
  status: "COMPLETED",
  sellerReceivableBreakdown: {
    grossAmount: gross === undefined ? undefined : { value: gross },
    paypalFee: fee === undefined ? undefined : { value: fee },
    netAmount: net === undefined ? undefined : { value: net },
  },
});

describe("totalFees", () => {
  it("reads fee and net from one capture", () => {
    assert.deepEqual(totalFees([capture("2000.00", "58.30", "1941.70")]), { fee: 58.3, net: 1941.7 });
  });

  it("adds up several captures without float drift", () => {
    const result = totalFees([capture("0.10", "0.01", "0.09"), capture("0.20", "0.02", "0.18")]);
    assert.deepEqual(result, { fee: 0.03, net: 0.27 });
  });

  it("works out net from gross minus fee when net is missing", () => {
    assert.deepEqual(totalFees([capture("100.00", "3.49")]), { fee: 3.49, net: 96.51 });
  });

  it("counts a missing fee as zero", () => {
    assert.deepEqual(totalFees([capture("50.00", undefined, "50.00")]), { fee: 0, net: 50 });
  });

  it("returns null for no captures", () => {
    assert.equal(totalFees([]), null);
  });

  it("skips captures with no breakdown, such as pending ones", () => {
    assert.equal(totalFees([{ status: "PENDING" }]), null);
    assert.deepEqual(totalFees([{ status: "PENDING" }, capture("10.00", "0.50", "9.50")]), { fee: 0.5, net: 9.5 });
  });

  it("ignores amounts that aren't numbers", () => {
    assert.equal(totalFees([capture("abc", "x", "y")]), null);
  });
});
