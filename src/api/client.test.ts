import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchSkills,
  getSkill,
  submitSkill,
  getSubmission,
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

describe("searchSkills", () => {
  it("encodes the query and parses the response", async () => {
    const apiData = {
      skills: [
        {
          name: "my-skill",
          author: "alice",
          certTier: "VERIFIED",
          certScore: 95,
          vskillInstalls: 1200,
          description: "A great skill",
        },
      ],
    };
    mockFetch.mockResolvedValue(jsonResponse(apiData));

    const results = await searchSkills("hello world");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills?search=hello%20world`,
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
        tier: "VERIFIED",
        score: 95,
        installs: 1200,
        description: "A great skill",
      },
    ]);
  });

  it("returns empty array when skills field is missing", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    const results = await searchSkills("nothing");

    expect(results).toEqual([]);
  });
});

describe("getSkill", () => {
  it("fetches a skill by name", async () => {
    const detail = {
      name: "test-skill",
      author: "bob",
      tier: "SCANNED",
      score: 50,
      version: "1.2.3",
      sha: "def456",
      description: "Test skill",
      installs: 300,
      updatedAt: "2026-02-01T00:00:00Z",
    };
    mockFetch.mockResolvedValue(jsonResponse(detail));

    const result = await getSkill("test-skill");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/skills/test-skill`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "vskill-cli",
        }),
      })
    );
    expect(result).toEqual(detail);
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
});

describe("headers", () => {
  it("sends correct Content-Type and User-Agent headers", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ skills: [] }));

    await searchSkills("test");

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1];
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["User-Agent"]).toBe("vskill-cli");
  });
});
