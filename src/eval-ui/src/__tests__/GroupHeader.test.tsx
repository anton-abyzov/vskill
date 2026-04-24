// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0698 T-008: GroupHeader — small-caps non-collapsible section label with count.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupHeader } from "../components/GroupHeader";

describe("GroupHeader (0698 T-008)", () => {
  it("renders the name and a count badge", () => {
    const html = renderToStaticMarkup(<GroupHeader name="AVAILABLE" count={47} />);
    expect(html).toContain("AVAILABLE");
    expect(html).toContain("(47)");
  });

  it("shows (0) when the count is zero — does NOT hide", () => {
    const html = renderToStaticMarkup(<GroupHeader name="AUTHORING" count={0} />);
    expect(html).toContain("AUTHORING");
    expect(html).toContain("(0)");
  });

  it("renders as a non-interactive heading (no button, no chevron)", () => {
    const html = renderToStaticMarkup(<GroupHeader name="AVAILABLE" count={3} />);
    // The component renders a <div role=heading>, not a <button>. Absence of
    // <button> proves non-collapsibility in rendered output.
    expect(html).not.toContain("<button");
    expect(html).toContain('role="heading"');
    expect(html).toContain('aria-level="3"');
  });

  it("uses uppercase tracking and muted styling (small-caps visual intent)", () => {
    const html = renderToStaticMarkup(<GroupHeader name="AUTHORING" count={5} />);
    expect(html).toContain("uppercase");
    expect(html).toContain("tracking-wide");
    expect(html).toContain("text-muted-foreground");
  });

  it("matches stored snapshot (regression guard)", () => {
    const html = renderToStaticMarkup(<GroupHeader name="AVAILABLE" count={12} />);
    expect(html).toMatchSnapshot();
  });

  it("accepts a custom className that composes with defaults", () => {
    const html = renderToStaticMarkup(
      <GroupHeader name="AVAILABLE" count={1} className="mt-4" />,
    );
    expect(html).toContain("mt-4");
    // Default classes still present
    expect(html).toContain("uppercase");
  });
});
