// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0824 — Studio Parameters & Secrets explainer UX
//
// Locks the contract for two presentational helpers exported from
// CredentialManager.tsx:
//   - <ParametersHeader />        renders the section heading, an info (i)
//                                 icon with native title="" tooltip mentioning
//                                 process.env + .env.local, and the "+ Add
//                                 Parameter" button. The (i) icon is mounted
//                                 regardless of credential count.
//   - <ParametersEmptyState />    renders a 3-block explainer card (headline,
//                                 body referencing .env.local + evals.json,
//                                 "Learn more →" anchor pointing to
//                                 verified-skill.com/docs/parameters-and-secrets
//                                 in a new tab with rel=noopener noreferrer).
//
// We render via renderToStaticMarkup (matches ProjectPicker.test.tsx pattern)
// because both helpers are pure props-in/JSX-out and don't need useEffect.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ParametersHeader,
  ParametersEmptyState,
} from "../CredentialManager";

describe("ParametersHeader (0824)", () => {
  it("renders the 'Parameters & Secrets' label", () => {
    const html = renderToStaticMarkup(
      <ParametersHeader onToggleAdd={vi.fn()} addFormOpen={false} />,
    );
    expect(html).toContain("Parameters &amp; Secrets");
  });

  it("renders an info (i) icon with a title attribute mentioning process.env and .env.local", () => {
    const html = renderToStaticMarkup(
      <ParametersHeader onToggleAdd={vi.fn()} addFormOpen={false} />,
    );
    // Native title="" tooltip primitive — matches existing pattern at
    // CredentialManager.tsx line 190 (revealedKeys toggle button).
    expect(html).toMatch(/title="[^"]*process\.env[^"]*"/);
    expect(html).toMatch(/title="[^"]*\.env\.local[^"]*"/);
  });

  it("renders the '+ Add Parameter' button", () => {
    const html = renderToStaticMarkup(
      <ParametersHeader onToggleAdd={vi.fn()} addFormOpen={false} />,
    );
    expect(html).toContain("+ Add Parameter");
  });
});

describe("ParametersEmptyState (0824)", () => {
  it("renders the 'No parameters yet' headline", () => {
    const html = renderToStaticMarkup(<ParametersEmptyState />);
    expect(html).toContain("No parameters yet");
  });

  it("body explains .env.local storage and evals.json declaration path", () => {
    const html = renderToStaticMarkup(<ParametersEmptyState />);
    expect(html).toContain(".env.local");
    expect(html).toContain("evals.json");
  });

  it("renders a 'Learn more' anchor pointing to the docs page in a new tab", () => {
    const html = renderToStaticMarkup(<ParametersEmptyState />);
    expect(html).toContain("Learn more");
    expect(html).toContain(
      'href="https://verified-skill.com/docs/parameters-and-secrets"',
    );
    expect(html).toContain('target="_blank"');
    // rel must contain both noopener and noreferrer (order-agnostic)
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });
});
