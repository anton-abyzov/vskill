// 0733: App.tsx suggested-agent fallback MUST route through
// `handleActiveAgentChange` (which writes localStorage AND dispatches
// `studio:agent-changed`) — NOT through the bare `setActiveAgentIdState`
// setter, which only updates React state and lets the persisted prefs
// drift away from the visible picker.
//
// This is a source-contract test (mirrors app-lazy-palette.test.ts) — the
// regex pins the wiring at the point that matters. A runtime mount of <App />
// would require stubbing 30+ contexts/hooks for what is fundamentally a
// one-line wire-up assertion.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("App.tsx — suggested-agent fallback persistence (0733)", () => {
  const appPath = resolve(__dirname, "../App.tsx");
  const source = readFileSync(appPath, "utf8");

  it("AC-US1-02 / AC-US1-03: hydration calls handleActiveAgentChange (persists + emits event)", () => {
    // Find the `if (!activeAgentId && agentsResponse.response?.suggested)` block.
    const block = source.match(
      /if\s*\(\s*!activeAgentId\s*&&\s*agentsResponse\.response\?\.suggested\s*\)\s*\{[\s\S]*?\n\s*\}/,
    );
    expect(block, "suggested-fallback block not found in App.tsx").not.toBeNull();
    const body = block![0];

    // The fix: must invoke handleActiveAgentChange(...) so localStorage AND
    // the studio:agent-changed event both fire.
    expect(body).toMatch(/handleActiveAgentChange\s*\(\s*agentsResponse\.response\.suggested\s*\)/);

    // Anti-regression: must NOT call the bare setter — that's the bug.
    expect(body).not.toMatch(/setActiveAgentIdState\s*\(\s*agentsResponse\.response\.suggested\s*\)/);
  });

  it("AC-US1-04: suggested fallback is gated on `!activeAgentId` (cannot overwrite explicit pref)", () => {
    // The `!activeAgentId` guard must remain — without it, the fallback
    // would clobber a previously-persisted explicit choice.
    expect(source).toMatch(
      /if\s*\(\s*!activeAgentId\s*&&\s*agentsResponse\.response\?\.suggested\s*\)/,
    );
  });
});
