// @vitest-environment jsdom
// 0741 T-007: TaintWarning port unit tests.
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: {
  reason?: string | null;
  blockedSkills?: { name: string; displayName: string }[];
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: TaintWarning } = await import("../TaintWarning");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(TaintWarning, props));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TaintWarning (ported)", () => {
  it("renders the Tainted heading and a default explanation when no reason is given", async () => {
    const h = await render({});
    expect(h.container.querySelector("[data-testid='taint-warning']")).toBeTruthy();
    expect(h.container.textContent).toContain("Tainted");
    expect(h.container.textContent).toContain("blocked for security reasons");
    h.unmount();
  });

  it("renders a custom reason when provided", async () => {
    const h = await render({ reason: "Sibling skill X was caught exfiltrating tokens." });
    expect(h.container.textContent).toContain("exfiltrating tokens");
    h.unmount();
  });

  it("renders blockedSkills as anchor links to skillUrl(name)", async () => {
    const h = await render({
      blockedSkills: [
        { name: "owner/repo/bad-skill", displayName: "Bad Skill" },
        { name: "owner/repo/worse-skill", displayName: "Worse Skill" },
      ],
    });
    const links = h.container.querySelectorAll("a");
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("/skills/owner/repo/bad-skill");
    expect(links[0].textContent).toBe("Bad Skill");
    expect(links[1].getAttribute("href")).toBe("/skills/owner/repo/worse-skill");
    h.unmount();
  });

  it("does NOT render the blocked-skills row when the array is empty", async () => {
    const h = await render({ blockedSkills: [] });
    expect(h.container.querySelectorAll("a").length).toBe(0);
    h.unmount();
  });
});
