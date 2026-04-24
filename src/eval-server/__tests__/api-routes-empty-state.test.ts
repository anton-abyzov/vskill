// ---------------------------------------------------------------------------
// 0704: GET /evals and GET /benchmark/latest return 200 sentinels instead
// of 404 when the underlying files are missing, so client code can treat
// "no evals yet" / "no benchmark yet" as empty state rather than an error.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  sendJson: vi.fn(),
  resolveSkillDir: vi.fn(),
  loadAndValidateEvals: vi.fn(),
  readBenchmark: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: mocks.existsSync,
  };
});

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendJson: mocks.sendJson,
  };
});

vi.mock("../skill-resolver.js", () => ({
  resolveSkillDir: mocks.resolveSkillDir,
}));

vi.mock("../../eval/schema.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadAndValidateEvals: mocks.loadAndValidateEvals,
  };
});

vi.mock("../../eval/benchmark.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readBenchmark: mocks.readBenchmark,
  };
});

const { registerRoutes } = await import("../api-routes.js");

function captureGetHandler(
  pathPattern: string,
): (req: any, res: any, params: Record<string, string>) => Promise<void> {
  let handler: any = null;
  const fakeRouter = {
    get: vi.fn((path: string, h: any) => {
      if (path === pathPattern) handler = h;
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerRoutes(fakeRouter as any, "/root");
  if (!handler) throw new Error(`GET ${pathPattern} handler not registered`);
  return handler;
}

describe("GET /api/skills/:plugin/:skill/evals — 0704 empty-state", () => {
  const fakeReq = {} as any;
  const fakeRes = {} as any;
  const params = { plugin: "p", skill: "s" };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillDir.mockReturnValue("/root/p/s");
  });

  it("returns 200 { exists: false, evals: [] } when evals.json is missing", async () => {
    mocks.existsSync.mockReturnValue(false);
    const handler = captureGetHandler("/api/skills/:plugin/:skill/evals");

    await handler(fakeReq, fakeRes, params);

    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { exists: false, evals: [] },
      200,
      fakeReq,
    );
    expect(mocks.loadAndValidateEvals).not.toHaveBeenCalled();
  });

  it("returns the validated EvalsFile with 200 when evals.json exists", async () => {
    mocks.existsSync.mockReturnValue(true);
    const evalsFile = { version: 1, evals: [{ id: "e1", prompt: "hi" }] };
    mocks.loadAndValidateEvals.mockReturnValue(evalsFile);
    const handler = captureGetHandler("/api/skills/:plugin/:skill/evals");

    await handler(fakeReq, fakeRes, params);

    expect(mocks.loadAndValidateEvals).toHaveBeenCalledWith("/root/p/s");
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, evalsFile, 200, fakeReq);
  });
});

describe("GET /api/skills/:plugin/:skill/benchmark/latest — 0704 empty-state", () => {
  const fakeReq = {} as any;
  const fakeRes = {} as any;
  const params = { plugin: "p", skill: "s" };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillDir.mockReturnValue("/root/p/s");
  });

  it("returns 200 null when no benchmark has been persisted", async () => {
    mocks.readBenchmark.mockResolvedValue(null);
    const handler = captureGetHandler("/api/skills/:plugin/:skill/benchmark/latest");

    await handler(fakeReq, fakeRes, params);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, null, 200, fakeReq);
  });

  it("returns 200 <benchmark> when a benchmark exists", async () => {
    const benchmark = { id: "b1", timestamp: "2026-04-24T00:00:00.000Z", runs: [] };
    mocks.readBenchmark.mockResolvedValue(benchmark);
    const handler = captureGetHandler("/api/skills/:plugin/:skill/benchmark/latest");

    await handler(fakeReq, fakeRes, params);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, benchmark, 200, fakeReq);
  });
});
