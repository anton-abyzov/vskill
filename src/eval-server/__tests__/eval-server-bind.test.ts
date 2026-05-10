// ---------------------------------------------------------------------------
// 0836 US-001 — eval-server MUST bind to 127.0.0.1 only.
//
// Today, `server.listen(port)` (no host arg) binds dual-stack (LAN-reachable).
// After the fix, the listen call MUST pass `'127.0.0.1'` so the kernel rejects
// non-loopback connects.
//
// Tests:
//   - server.address() reports `127.0.0.1` (not `0.0.0.0` / `::`)
//   - a TCP connect to a non-loopback host IP returns ECONNREFUSED
// ---------------------------------------------------------------------------

import { afterAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";

import { startEvalServer } from "../eval-server.js";

// Use OS tmp dir as workspace to avoid touching ~/.vskill on the test host.
const tmpRoot = os.tmpdir();

const launchedServers: http.Server[] = [];

afterAll(async () => {
  await Promise.all(
    launchedServers.map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});

async function launch(): Promise<http.Server> {
  const server = await startEvalServer({
    port: 0,
    root: tmpRoot,
    workspaceDir: tmpRoot,
  });
  launchedServers.push(server);
  return server;
}

describe("eval-server — loopback-only bind (US-001)", () => {
  it("AC-US1-01/02: server.address().address is 127.0.0.1 (not 0.0.0.0 or ::)", async () => {
    const server = await launch();
    const addr = server.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe("object");
    const info = addr as net.AddressInfo;
    expect(info.address).toBe("127.0.0.1");
    expect(info.address).not.toBe("0.0.0.0");
    expect(info.address).not.toBe("::");
  });

  it("AC-US1-04: TCP connect from a non-loopback host IP fails with ECONNREFUSED", async () => {
    const server = await launch();
    const info = server.address() as net.AddressInfo;

    // Find a non-loopback IPv4 the host owns. If none exists (CI w/o nics),
    // skip this assertion — the address() check already covers AC-US1-01/02.
    const nonLoopbackIp = pickNonLoopbackIPv4();
    if (!nonLoopbackIp) {
      expect(info.address).toBe("127.0.0.1");
      return;
    }

    // Try to connect to (nonLoopbackIp, info.port). With a 127.0.0.1 bind,
    // the kernel refuses the SYN — we expect ECONNREFUSED (or ETIMEDOUT in
    // the rare router-rewrite case; either is success here, what we MUST
    // NOT see is a successful handshake).
    const result = await tryConnect(nonLoopbackIp, info.port, 1500);
    expect(result.connected).toBe(false);
    // Sanity: with the legacy 0.0.0.0 bind, this connect WOULD succeed —
    // catching it here is the whole point of the test.
  });

  it("AC-US1-03: loopback access still works (regression guard)", async () => {
    const server = await launch();
    const info = server.address() as net.AddressInfo;

    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port: info.port }, () => {
        socket.end();
        resolve(true);
      });
      socket.setTimeout(1500, () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => resolve(false));
    });
    expect(ok).toBe(true);
  });
});

function pickNonLoopbackIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] ?? []) {
      if (a.family === "IPv4" && !a.internal && a.address !== "127.0.0.1") {
        return a.address;
      }
    }
  }
  return null;
}

async function tryConnect(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ connected: boolean; errorCode?: string }> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finalize = (result: { connected: boolean; errorCode?: string }) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    socket.once("connect", () => finalize({ connected: true }));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      finalize({ connected: false, errorCode: err.code }),
    );
    socket.setTimeout(timeoutMs, () =>
      finalize({ connected: false, errorCode: "ETIMEDOUT" }),
    );
  });
}
