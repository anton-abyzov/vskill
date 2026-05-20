import { describe, expect, it } from "vitest";
import { normalizeUpdateInfo } from "./useDesktopBridge";

describe("normalizeUpdateInfo", () => {
  it("maps the Rust updater wire shape into the Preferences UI shape", () => {
    const info = normalizeUpdateInfo(
      {
        available: true,
        version: "1.0.40",
        notes: "Desktop release notes from latest.json",
        pub_date: "2026-05-20T06:00:00Z",
      },
      "1.0.39",
    );

    expect(info).toEqual({
      available: true,
      currentVersion: "1.0.39",
      latestVersion: "1.0.40",
      releaseNotes: "Desktop release notes from latest.json",
      releaseDate: "2026-05-20T06:00:00Z",
    });
  });
});
