// ---------------------------------------------------------------------------
// 0701 T-008: LM Studio CTA copy + tooltip string assertions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { strings } from "../strings";

describe("0701 T-008: LM Studio CTA strings", () => {
  it("LM Studio startServiceCta is 'Start LM Studio server →'", () => {
    expect(strings.providers.lmStudio.startServiceCta).toBe("Start LM Studio server →");
  });

  it("LM Studio startServiceTooltip explains Developer → Start Server", () => {
    expect(
      (strings.providers.lmStudio as { startServiceTooltip?: string }).startServiceTooltip,
    ).toBe("Open LM Studio → Developer tab → Start Server (default port 1234).");
  });

  it("Ollama startServiceCta is unchanged ('Start service →')", () => {
    expect(strings.providers.ollama.startServiceCta).toBe("Start service →");
  });
});
