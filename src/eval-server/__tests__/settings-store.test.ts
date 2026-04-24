// ---------------------------------------------------------------------------
// settings-store.test.ts — Only tests that survive the FileBackedStore rewrite.
//
// Tier / Keychain tests were deleted in 0702 Phase 1 (T-009). Full coverage
// of the new store lives in file-backed-store.test.ts. This file keeps the
// tiny redactKey sanity checks so the public utility remains pinned.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import * as store from "../settings-store.js";

describe("settings-store — redactKey", () => {
  it("returns ****<last-4>", () => {
    expect(store.redactKey("sk-ant-abcd1234")).toBe("****1234");
  });
  it("collapses short keys to ****", () => {
    expect(store.redactKey("1234")).toBe("****");
    expect(store.redactKey("")).toBe("****");
  });
});
