import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  searchSkills,
  getSkill,
  submitSkill,
  getSubmission,
  reportInstall,
} from "./client.js";
import type { SubmissionRequest } from "./client.js";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(data: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function errorResponse(status: number, statusText: string, body = "") {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(body),
  };
}

const BASE_URL = "https://verified-skill.com";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("searchSkills", () => {
  it("encodes the query and parses the response", async () => {
    const apiData = {
      results: [
        {
          name: "my-skill",
          author: "alice",
          certTier: "VERIFIED",
          trustScore: 95,
          description: "A great skill",
        },
      ],
    };
    mockFetch.mockResolvedValue(jsonResponse(apiData));

    const results = await searchSkills("hello world");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills/search?q=hello%20world`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "vskill-cli",
        }),
      })
    );

    expect(results).toEqual([
      {
        name: "my-skill",
        author: "alice",
        repoUrl: undefined,
        tier: "VERIFIED",
        score: 95,
        description: "A great skill",
        command: null,
        pluginName: null,
        isTainted: false,
        isBlocked: false,
        threatType: undefined,
        severity: undefined,
      },
    ]);
  });

  it("returns empty array when results field is missing", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    const results = await searchSkills("nothing");

    expect(results).toEqual([]);
  });

  it("falls back to 'tier' when 'certTier' is missing", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ results: [{ name: "s", tier: "VERIFIED" }] })
    );
    const results = await searchSkills("test");
    expect(results[0].tier).toBe("VERIFIED");
  });

  it("defaults tier to 'VERIFIED' when no tier field exists", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ results: [{ name: "s" }] })
    );
    const results = await searchSkills("test");
    expect(results[0].tier).toBe("VERIFIED");
  });

  it("uses trustScore as primary score source", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ results: [{ name: "s", trustScore: 80 }] })
    );
    const results = await searchSkills("test");
    expect(results[0].score).toBe(80);
  });

  it("falls back to 'certScore' when 'trustScore' is missing", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ results: [{ name: "s", certScore: 75 }] })
    );
    const results = await searchSkills("test");
    expect(results[0].score).toBe(75);
  });

  it("falls back to 'score' when 'trustScore' and 'certScore' are missing", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ results: [{ name: "s", score: 60 }] })
    );
    const results = await searchSkills("test");
    expect(results[0].score).toBe(60);
  });

  it("defaults score to 0 when no score field exists", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ results: [{ name: "s" }] })
    );
    const results = await searchSkills("test");
    expect(results[0].score).toBe(0);
  });
});

describe("getSkill", () => {
  it("unwraps the skill wrapper and normalizes field names", async () => {
    const apiResponse = {
      skill: {
        name: "remotion-dev-skills-remotion",
        author: "remotion-dev",
        certTier: "VERIFIED",
        certScore: null,
        currentVersion: "1.0.0",
        sha: "",
        description: "A great skill",
        vskillInstalls: 0,
        updatedAt: "2026-02-20T00:00:00Z",
        repoUrl: "https://github.com/remotion-dev/skills",
      },
    };
    mockFetch.mockResolvedValue(jsonResponse(apiResponse));

    const result = await getSkill("remotion-dev-skills-remotion");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills/remotion-dev-skills-remotion`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "vskill-cli",
        }),
      })
    );
    expect(result.name).toBe("remotion-dev-skills-remotion");
    expect(result.author).toBe("remotion-dev");
    expect(result.tier).toBe("VERIFIED");
    expect(result.score).toBe(0);
    expect(result.version).toBe("1.0.0");
    expect(result.installs).toBe(0);
    expect(result.repoUrl).toBe("https://github.com/remotion-dev/skills");
    expect(result.content).toBeUndefined();
  });

  it("falls back to flat response when no skill wrapper exists", async () => {
    const detail = {
      name: "test-skill",
      author: "bob",
      tier: "VERIFIED",
      score: 50,
      version: "1.2.3",
      sha: "def456",
      description: "Test skill",
      installs: 300,
      updatedAt: "2026-02-01T00:00:00Z",
    };
    mockFetch.mockResolvedValue(jsonResponse(detail));

    const result = await getSkill("test-skill");

    expect(result.name).toBe("test-skill");
    expect(result.author).toBe("bob");
    expect(result.tier).toBe("VERIFIED");
    expect(result.score).toBe(50);
    expect(result.version).toBe("1.2.3");
  });

  it("normalizes certTier and certScore field aliases", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      skill: { name: "s", author: "a", certTier: "CERTIFIED", certScore: 95, currentVersion: "2.0.0", vskillInstalls: 42 },
    }));
    const result = await getSkill("s");
    expect(result.tier).toBe("CERTIFIED");
    expect(result.score).toBe(95);
    expect(result.version).toBe("2.0.0");
    expect(result.installs).toBe(42);
  });

  it("returns content when present in response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({
      skill: { name: "s", author: "a", content: "# My Skill\nDoes things." },
    }));
    const result = await getSkill("s");
    expect(result.content).toBe("# My Skill\nDoes things.");
  });

  it("encodes special characters in skill name", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ name: "@org/skill" }));

    await getSkill("@org/skill");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills/%40org%2Fskill`,
      expect.any(Object)
    );
  });
});

describe("submitSkill", () => {
  it("sends a POST request with JSON body", async () => {
    const submission: SubmissionRequest = {
      repoUrl: "https://github.com/alice/skill-repo",
      skillName: "my-skill",
      email: "alice@example.com",
    };
    const responseData = {
      id: "sub-123",
      status: "pending",
      trackingUrl: "https://verified-skill.com/submissions/sub-123",
    };
    mockFetch.mockResolvedValue(jsonResponse(responseData));

    const result = await submitSkill(submission);

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/submissions`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(submission),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "vskill-cli",
        }),
      })
    );
    expect(result).toEqual(responseData);
  });
});

describe("getSubmission", () => {
  it("fetches submission by ID", async () => {
    const data = { id: "sub-456", status: "completed", result: { ok: true } };
    mockFetch.mockResolvedValue(jsonResponse(data));

    const result = await getSubmission("sub-456");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/submissions/sub-456`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "vskill-cli",
        }),
      })
    );
    expect(result).toEqual(data);
  });
});

describe("error handling", () => {
  it("throws on non-ok response with status info", async () => {
    mockFetch.mockResolvedValue(
      errorResponse(404, "Not Found", "skill not found")
    );

    await expect(getSkill("nonexistent")).rejects.toThrow(
      /API request failed: 404 Not Found/
    );
  });

  it("includes response body in error message", async () => {
    mockFetch.mockResolvedValue(
      errorResponse(500, "Internal Server Error", "database error")
    );

    await expect(searchSkills("test")).rejects.toThrow(/database error/);
  });

  it("handles empty error body gracefully", async () => {
    mockFetch.mockResolvedValue(errorResponse(403, "Forbidden", ""));

    await expect(submitSkill({ repoUrl: "https://x.com/r" })).rejects.toThrow(
      /API request failed: 403 Forbidden/
    );
  });

  it("propagates network errors when fetch throws", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(searchSkills("test")).rejects.toThrow("Failed to fetch");
  });
});

describe("headers", () => {
  it("sends correct Content-Type and User-Agent headers", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("test");

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1];
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["User-Agent"]).toBe("vskill-cli");
  });
});

describe("reportInstall", () => {
  it("sends POST to correct URL", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await reportInstall("my-skill");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills/my-skill/installs`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "User-Agent": "vskill-cli",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({}),
      }),
    );
  });

  it("sends repoUrl in body when provided", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await reportInstall("architect", "anton-abyzov/specweave");

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.repoUrl).toBe("anton-abyzov/specweave");
  });

  it("encodes special characters in skill name", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await reportInstall("@org/my-skill");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills/%40org%2Fmy-skill/installs`,
      expect.any(Object),
    );
  });

  it("respects VSKILL_NO_TELEMETRY=1", async () => {
    const orig = process.env.VSKILL_NO_TELEMETRY;
    process.env.VSKILL_NO_TELEMETRY = "1";
    try {
      await reportInstall("my-skill");
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      if (orig === undefined) delete process.env.VSKILL_NO_TELEMETRY;
      else process.env.VSKILL_NO_TELEMETRY = orig;
    }
  });

  it("swallows network errors silently", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    // Should not throw
    await expect(reportInstall("my-skill")).resolves.toBeUndefined();
  });

  it("swallows non-ok responses silently", async () => {
    mockFetch.mockResolvedValue(errorResponse(500, "Internal Server Error"));

    // Should not throw (reportInstall doesn't use apiRequest)
    await expect(reportInstall("my-skill")).resolves.toBeUndefined();
  });

  it("passes an AbortSignal for timeout", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await reportInstall("my-skill");

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});
