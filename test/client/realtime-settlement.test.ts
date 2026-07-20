import { describe, expect, it } from "vitest";
import {
  requireSuccessfulSettlement,
  SETTLEMENT_SUCCEEDED,
} from "../../src/client/realtime/use-realtime-settlement";

describe("realtime settlement result guard", () => {
  it("accepts a completed persistence barrier", () => {
    expect(() => requireSuccessfulSettlement(SETTLEMENT_SUCCEEDED)).not.toThrow();
  });

  it("preserves and throws the original persistence failure", () => {
    const error = new Error("persistence acknowledgement failed");

    expect(() =>
      requireSuccessfulSettlement({ ok: false, error }),
    ).toThrow(error);
  });
});
