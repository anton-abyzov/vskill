import React from "react";
import { createRoot } from "react-dom/client";
import { QuotaProvider } from "../src/contexts/QuotaContext";
import { PublishStatusRow } from "../src/components/PublishStatusRow";
import { useTier } from "../src/hooks/useTier";
import "../src/styles/globals.css";

function Surface() {
  const { tier } = useTier();
  return <main style={{ maxWidth: 960, padding: "40px 20px", margin: "0 auto", color: "#e7edf3" }}>
    <p style={{ fontSize: 12, color: "#a0acba" }}>Skill Studio · Overview · <span data-testid="tier">{tier}</span></p>
    <h1 style={{ margin: "12px 0 24px", fontSize: 28 }}>Private team skill</h1>
    <PublishStatusRow skillName="private-team-skill" skillPath="skills/private-team-skill/SKILL.md" />
  </main>;
}
document.body.style.background = "#10141b";
document.body.style.minHeight = "100vh";
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(<QuotaProvider><Surface /></QuotaProvider>);
