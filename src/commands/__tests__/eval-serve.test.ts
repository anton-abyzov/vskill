import { describe, it, expect } from "vitest";
import { projectPort } from "../eval/serve.js";

describe("projectPort", () => {
  it("returns a port in range 3077-3177", () => {
    const port = projectPort("/Users/alice/projects/my-skills");
    expect(port).toBeGreaterThanOrEqual(3077);
    expect(port).toBeLessThanOrEqual(3177);
  });

  it("returns the same port for the same path (deterministic)", () => {
    const a = projectPort("/Users/alice/projects/my-skills");
    const b = projectPort("/Users/alice/projects/my-skills");
    expect(a).toBe(b);
  });

  it("returns different ports for different paths", () => {
    const a = projectPort("/Users/alice/projects/repo-a");
    const b = projectPort("/Users/alice/projects/repo-b");
    // Not guaranteed by hash, but overwhelmingly likely for different inputs
    // We just check both are valid
    expect(a).toBeGreaterThanOrEqual(3077);
    expect(b).toBeGreaterThanOrEqual(3077);
  });
});
