// @vitest-environment jsdom
// 0826 T-049 — Studio private skill detail view: persistent PRIVATE banner.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioPrivateSkillView } from "../components/private/StudioPrivateSkillView";

describe("StudioPrivateSkillView (AC-US13-05)", () => {
  it("renders PrivateBanner with the tenant name at the top", () => {
    const html = renderToStaticMarkup(
      <StudioPrivateSkillView
        skill={{
          slug: "internal-deploy",
          name: "internal-deploy",
          tenantName: "acme",
          description: "Internal deploy",
          version: "2.4.1",
          readme: "# internal-deploy",
        }}
      />,
    );
    expect(html).toMatch(/role="banner"/);
    expect(html).toMatch(/data-private-banner="true"/);
    expect(html).toMatch(/visible to.*acme.*members only/);
  });

  it("PrivateBadge is rendered next to the title (visual reinforcement)", () => {
    const html = renderToStaticMarkup(
      <StudioPrivateSkillView skill={{ slug: "x", name: "x", tenantName: "globex" }} />,
    );
    expect(html).toMatch(/aria-label="Private skill — visible to globex members only"/);
  });
});
