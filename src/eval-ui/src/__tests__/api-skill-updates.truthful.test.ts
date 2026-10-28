// 1126 P0-1 / P1-4 / P1-6: the update client reports what the server says,
// not the HTTP status of an SSE stream that is always 200.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";
import { interpretUpdateFrames, parseSseFrames, readSseStream } from "../api-skill-updates";

const mockFetch = vi.fn();
global.fetch = mockFetch;
beforeEach(() => mockFetch.mockReset());

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A Response whose body arrives in the given chunks (split mid-frame on purpose). */
function chunked(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("parseSseFrames / readSseStream", () => {
  it("parses event + JSON data blocks", () => {
    expect(parseSseFrames(frame("progress", { a: 1 }) + frame("done", { status: "done" }))).toEqual([
      { event: "progress", data: { a: 1 } },
      { event: "done", data: { status: "done" } },
    ]);
  });

  it("reassembles frames split across chunks", async () => {
    const text = frame("progress", { status: "updating" }) + frame("done", { status: "done", version: "1.2.0" });
    const seen: string[] = [];
    await readSseStream(chunked([text.slice(0, 17), text.slice(17, 50), text.slice(50)]), (f) => seen.push(f.event));
    expect(seen).toEqual(["progress", "done"]);
  });
});

describe("postSkillUpdate", () => {
  it("is ok only when done.status is done, and returns the new version", async () => {
    mockFetch.mockResolvedValue(chunked([frame("progress", { status: "updating" }), frame("done", { status: "done", version: "2.1.0" })]));
    const r = await api.postSkillUpdate("p", "foo");
    expect(r).toEqual(expect.objectContaining({ ok: true, version: "2.1.0", outcome: "done" }));
  });

  it("an error stream on HTTP 200 is a failure carrying the error text", async () => {
    mockFetch.mockResolvedValue(
      chunked([frame("error", { error: "could not fetch update from any source" }), frame("done", { status: "error" })]),
    );
    const r = await api.postSkillUpdate("p", "foo");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(200);
    expect(r.body).toBe("could not fetch update from any source");
  });

  it("a pinned skip is skipped, not ok", async () => {
    mockFetch.mockResolvedValue(
      chunked([frame("done", { status: "skipped", reason: "pinned", pinnedVersion: "1.0.0", message: "Pinned at 1.0.0; unpin it to update." })]),
    );
    const r = await api.postSkillUpdate("p", "foo");
    expect(r).toEqual(expect.objectContaining({ ok: false, skipped: true, skipReason: "pinned", pinnedVersion: "1.0.0" }));
  });

  it("a stream that ends without done is a failure", () => {
    expect(interpretUpdateFrames(true, 200, [{ event: "progress", data: {} }]).ok).toBe(false);
  });
});

describe("getSkillUpdates", () => {
  it("degrades to [] by default but throws the server's message with throwOnError", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Couldn't check for updates: rate limited" }), { status: 502 }));
    expect(await api.getSkillUpdates()).toEqual([]);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Couldn't check for updates: rate limited" }), { status: 502 }));
    await expect(api.getSkillUpdates({ throwOnError: true })).rejects.toThrow("rate limited");
  });
});

describe("pin and fleet client", () => {
  it("pins, unpins and installs a version through the pin routes", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ found: true, pinned: true, pinnedVersion: "1.0.0" }), { status: 200 }));
    await api.pinSkill("p", "foo");
    expect(mockFetch.mock.calls[0][0]).toBe("/api/skills/p/foo/pin");
    expect(mockFetch.mock.calls[0][1].method).toBe("POST");

    mockFetch.mockResolvedValue(new Response(JSON.stringify({ found: true, pinned: false }), { status: 200 }));
    await api.unpinSkill("p", "foo");
    expect(mockFetch.mock.calls[1][1].method).toBe("DELETE");

    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Couldn't install 9.9.9: not found" }), { status: 502 }));
    await expect(api.installSkillVersion("p", "foo", "9.9.9", false)).rejects.toThrow("not found");
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ version: "9.9.9", pin: false });
  });

  it("fleet push returns per-machine results and the not-available message", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, results: [{ machine: "m1", ok: true, installedVersion: "1.0.0" }] }), { status: 200 }),
    );
    const ok = await api.pushSkillToFleet("p", "foo", "1.0.0", true);
    expect(ok.results).toEqual([{ machine: "m1", ok: true, installedVersion: "1.0.0" }]);

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, notAvailable: true, error: "fleet skills is not available on this SpecWithCode yet." }), { status: 501 }),
    );
    const na = await api.pushSkillToFleet("p", "foo", "1.0.0", true);
    expect(na).toEqual(expect.objectContaining({ ok: false, notAvailable: true }));

    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await api.getFleetStatus()).toEqual({ available: false, skillsSupported: false, machines: null });
  });
});
