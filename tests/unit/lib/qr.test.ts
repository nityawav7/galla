import { encode } from "uqr";
import { describe, expect, it } from "vitest";

import { qrPath } from "@/lib/qr";

describe("qrPath", () => {
  const link = "upi://pay?pa=shop@oksbi&pn=Sharma%20Hardware&am=802.00&cu=INR&tn=SH%2F26-27%2F0001";

  it("draws one 1×1 square per dark module, with a 4-module quiet zone", () => {
    const { size, d } = qrPath(link);
    const { data } = encode(link, { ecc: "M", border: 4 });
    const dark = data.flat().filter(Boolean).length;
    expect(size).toBe(data.length);
    expect(d.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
    // The quiet zone stays empty: no square starts in the first 4 rows or columns.
    expect(d).not.toMatch(/M[0-3] /);
    expect(d).not.toMatch(/M\d+ [0-3]h/);
  });

  it("is deterministic", () => {
    expect(qrPath(link)).toEqual(qrPath(link));
  });
});
