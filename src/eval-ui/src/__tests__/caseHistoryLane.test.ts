// ---------------------------------------------------------------------------
// Tests: getLane — entry type to lane assignment
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getLane } from "../pages/workspace/TestsPanel.js";

describe("getLane", () => {
  it("maps benchmark to left", () => {
    expect(getLane("benchmark")).toBe("left");
  });

  it("maps baseline to right", () => {
    expect(getLane("baseline")).toBe("right");
  });

  it("maps comparison to full", () => {
    expect(getLane("comparison")).toBe("full");
  });

  it("maps improve to left", () => {
    expect(getLane("improve")).toBe("left");
  });

  it("maps instruct to left", () => {
    expect(getLane("instruct")).toBe("left");
  });

  it("maps model-compare to left", () => {
    expect(getLane("model-compare")).toBe("left");
  });

  it("maps ai-generate to left", () => {
    expect(getLane("ai-generate")).toBe("left");
  });

  it("maps eval-generate to left", () => {
    expect(getLane("eval-generate")).toBe("left");
  });

  it("maps unknown type to left", () => {
    expect(getLane("unknown-type")).toBe("left");
  });
});
