import { describe, it, expect } from "vitest";
import { runwayDays, validatorStatus } from "../src/derive.js";

describe("validatorStatus", () => {
  it("prioritises banned, then priming, then active/pending", () => {
    expect(validatorStatus({ banned: true, needsPriming: true, active: true })).toBe("banned");
    expect(validatorStatus({ banned: false, needsPriming: true, active: true })).toBe("needs_priming");
    expect(validatorStatus({ banned: false, needsPriming: false, active: true })).toBe("active");
    expect(validatorStatus({ banned: false, needsPriming: false, active: false })).toBe("pending");
  });
});

describe("runwayDays", () => {
  const D = 86400;
  it("projects days left from burn rate", () => {
    expect(runwayDays([{ t: 0, wei: 100n }, { t: D, wei: 90n }])).toBeCloseTo(9);
  });
  it("ignores top-ups when measuring burn", () => {
    expect(runwayDays([{ t: 0, wei: 100n }, { t: D / 2, wei: 50n }, { t: D, wei: 150n }])).toBeCloseTo(3);
  });
  it("is null without a measurable burn", () => {
    expect(runwayDays([{ t: 0, wei: 5n }])).toBeNull();
    expect(runwayDays([{ t: 0, wei: 5n }, { t: D, wei: 5n }])).toBeNull();
  });
});
