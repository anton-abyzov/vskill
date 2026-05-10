// ---------------------------------------------------------------------------
// tenant-resolver.test.ts — 0839 ADR-002 priority chain (T-010 helper).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveTenant } from "../tenant-resolver.js";
import type { TenantSummary } from "../../api/client.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-resolver-"));
}

const acmeT: TenantSummary = {
  tenantId: "t_acme",
  slug: "acme",
  name: "Acme",
  role: "owner",
};
const contosoT: TenantSummary = {
  tenantId: "t_contoso",
  slug: "contoso",
  name: "Contoso",
  role: "member",
};

describe("0839 ADR-002 — resolveTenant priority chain", () => {
  it("flag wins over everything", async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ currentTenant: "from-config" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const r = await resolveTenant({
      flag: "from-flag",
      envValue: "from-env",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => [acmeT, contosoT],
    });
    expect(r.kind).toBe("flag");
    if (r.kind === "flag") expect(r.slug).toBe("from-flag");
  });

  it("env wins over config + auto-pick", async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ currentTenant: "from-config" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const r = await resolveTenant({
      envValue: "from-env",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => [acmeT],
    });
    expect(r.kind).toBe("env");
    if (r.kind === "env") expect(r.slug).toBe("from-env");
  });

  it("config wins over auto-pick", async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ currentTenant: "from-config" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => [acmeT, contosoT],
    });
    expect(r.kind).toBe("config");
    if (r.kind === "config") expect(r.slug).toBe("from-config");
  });

  it("auto-picks when user has N=1 tenant", async () => {
    const dir = tmpDir();
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => [acmeT],
    });
    expect(r.kind).toBe("auto-pick");
    if (r.kind === "auto-pick") expect(r.slug).toBe("acme");
  });

  it("multiple tenants with no default → none + tenants list", async () => {
    const dir = tmpDir();
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => [acmeT, contosoT],
    });
    expect(r.kind).toBe("none");
    if (r.kind === "none") {
      expect(r.reason).toBe("multiple-tenants-no-default");
      expect(r.tenants).toHaveLength(2);
    }
  });

  it("anonymous (401 from listTenants) → reason: anonymous", async () => {
    const dir = tmpDir();
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => {
        const e = new Error("401") as Error & { status?: number };
        e.status = 401;
        throw e;
      },
    });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason).toBe("anonymous");
  });

  it("zero tenants → reason: no-tenants", async () => {
    const dir = tmpDir();
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => [],
    });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason).toBe("no-tenants");
  });

  it("enableAutoPick=false skips network entirely on miss", async () => {
    const dir = tmpDir();
    let called = false;
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      enableAutoPick: false,
      listTenants: async () => {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
    expect(r.kind).toBe("none");
  });

  it("flag wins even when enableAutoPick=false", async () => {
    const dir = tmpDir();
    const r = await resolveTenant({
      flag: "explicit",
      envValue: "",
      activeTenantOptions: { configDir: dir },
      enableAutoPick: false,
    });
    expect(r.kind).toBe("flag");
  });
});
