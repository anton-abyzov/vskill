// ---------------------------------------------------------------------------
// 0830 US-009 — Manifest server fixture for desktop auto-update smoke test.
//
// PURPOSE
//   In v1, the auto-update flow is exercised against MOCKED Tauri IPC inside a
//   Playwright browser session (see ./auto-update.spec.ts header for full
//   architectural rationale). This file is **scaffolding** for a follow-on
//   port that runs the spec against a real `tauri-driver` + `webdriverio`
//   stack — at that point the Rust `tauri-plugin-updater` will hit a real
//   manifest URL and these fixtures become live.
//
//   The current spec does NOT boot this server. It is exported so:
//     1. The fixture shapes (latest.json for v0.1.0, v0.2.0, signature-bad)
//        are version-controlled and reviewable as data.
//     2. A future native-driver port can `import { startManifestServer } from
//        "./fixtures/manifest-server"` and point Tauri's updater endpoint at
//        the returned URL via env or config override.
//
// SHAPE
//   `latest.json` matches the `tauri-plugin-updater` v2 schema:
//     {
//       version: string,
//       notes: string,
//       pub_date: string (ISO-8601),
//       platforms: {
//         "darwin-aarch64": {
//           signature: string (minisign .sig contents),
//           url: string  // .app.tar.gz download
//         },
//         ...
//       }
//     }
// ---------------------------------------------------------------------------
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ManifestPlatform {
  signature: string;
  url: string;
}

export interface ManifestDoc {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, ManifestPlatform>;
}

export const MANIFEST_V010_NO_UPDATE: ManifestDoc = {
  version: "0.1.0",
  notes: "Initial release.",
  pub_date: "2026-04-01T00:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature:
        "untrusted comment: signature\nRWQfixturev010aarch64=\ntrusted comment: v0.1.0 fixture\n",
      url: "http://127.0.0.1:0/Skill_Studio_0.1.0_aarch64.app.tar.gz",
    },
  },
};

export const MANIFEST_V020_AVAILABLE: ManifestDoc = {
  version: "0.2.0",
  notes: "Test release notes for the desktop auto-update smoke spec.",
  pub_date: "2026-05-07T00:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature:
        "untrusted comment: signature\nRWQfixturev020aarch64=\ntrusted comment: v0.2.0 fixture\n",
      url: "http://127.0.0.1:0/Skill_Studio_0.2.0_aarch64.app.tar.gz",
    },
  },
};

// Same payload as v020, but the signature was generated with a DIFFERENT
// minisign secret key — `tauri-plugin-updater` will reject it. Used by the
// AC-US9-05 negative path.
export const MANIFEST_V020_BAD_SIGNATURE: ManifestDoc = {
  version: "0.2.0",
  notes: "Test release with WRONG signing key (negative path fixture).",
  pub_date: "2026-05-07T00:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature:
        "untrusted comment: signature\nRWQwrongkeysig0830spec==\ntrusted comment: WRONG-KEY fixture\n",
      url: "http://127.0.0.1:0/Skill_Studio_0.2.0_aarch64.app.tar.gz",
    },
  },
};

export type ManifestVariant = "no-update" | "v020-available" | "v020-bad-signature";

export interface ManifestServer {
  url: string;
  setVariant: (variant: ManifestVariant) => void;
  close: () => Promise<void>;
}

/**
 * Boot a local HTTP server that serves the manifest variants under
 * `/desktop/latest.json`. Returns the server URL so a future native-driver
 * spec can pass it to `tauri.conf.json` via the `TAURI_UPDATER_ENDPOINT_URL`
 * env override.
 *
 * NOT used by the v1 HTTP-mock spec — included as scaffolding only.
 */
export async function startManifestServer(): Promise<ManifestServer> {
  let variant: ManifestVariant = "no-update";

  const server = http.createServer((req, res) => {
    if (req.url === "/desktop/latest.json") {
      const body =
        variant === "v020-available"
          ? MANIFEST_V020_AVAILABLE
          : variant === "v020-bad-signature"
            ? MANIFEST_V020_BAD_SIGNATURE
            : MANIFEST_V010_NO_UPDATE;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    setVariant: (next) => {
      variant = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
