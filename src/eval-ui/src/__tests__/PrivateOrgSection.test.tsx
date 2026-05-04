// @vitest-environment jsdom
// 0826 T-048 — Studio CLI sidebar mirror: Private Org section state matrix.
// Verifies AC-US13-01..05: split sections, amber tint, no-auth CTA card,
// no-installations message, PRIVATE badge only on org entries.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivateOrgSection } from "../components/private/PrivateOrgSection";

describe("PrivateOrgSection (Studio CLI)", () => {
  it("orgs=null renders the 'Connect GitHub' CTA card (AC-US13-02)", () => {
    const html = renderToStaticMarkup(<PrivateOrgSection orgs={null} />);
    expect(html).toMatch(/data-state="no-auth"/);
    expect(html).toMatch(/Connect your GitHub org/i);
    expect(html).toMatch(/vskill auth login/i);
  });

  it("orgs=[] renders the 'no installations' message (AC-US13-03)", () => {
    const html = renderToStaticMarkup(<PrivateOrgSection orgs={[]} />);
    expect(html).toMatch(/data-state="no-installations"/);
    expect(html).toMatch(/No orgs have installed/i);
  });

  it("renders one tinted org section per installation with PRIVATE badge (AC-US13-01, AC-US13-04)", () => {
    const html = renderToStaticMarkup(
      <PrivateOrgSection
        orgs={[
          { slug: "acme", name: "acme", skills: [{ slug: "deploy", name: "deploy" }] },
          { slug: "globex", name: "globex", skills: [] },
        ]}
      />,
    );
    expect(html).toMatch(/data-org-section="acme"/);
    expect(html).toMatch(/data-org-section="globex"/);
    // PRIVATE badge present (role=status with the canonical aria-label).
    expect(html).toMatch(/role="status"/);
    expect(html).toMatch(/aria-label="Private skill — visible to acme members only"/);
  });

  it("amber tint is applied to the org section background (visual contract)", () => {
    const html = renderToStaticMarkup(
      <PrivateOrgSection orgs={[{ slug: "acme", name: "acme", skills: [] }]} />,
    );
    // Amber tint via inline style — pinned by RGB to catch a regression that
    // swaps to a green/blue safe-public color.
    expect(html).toMatch(/rgba\(252,\s*211,\s*77,\s*0\.18\)/);
  });
});
