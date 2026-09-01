#!/usr/bin/env python3
"""Preflight: is the Excalidraw MCP server registered on this machine? Register it.

Installing a skill never installs an MCP server — `mcp-deps` is a declaration, not
an installer. Run this once on a new machine (macOS, Linux or Windows) before the
first live render.

    python3 scripts/ensure_mcp.py              # report only
    python3 scripts/ensure_mcp.py --install    # register it if missing
    python3 scripts/ensure_mcp.py --install --scope project   # write ./.mcp.json

On Windows use `py -3 scripts\\ensure_mcp.py` — `python3` there is a Microsoft Store
stub that opens the Store instead of running anything.

Exit codes: 0 configured (or newly registered), 1 missing, 2 cannot register.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

SERVER_NAME = "excalidraw"
SERVER_URL = "https://mcp.excalidraw.com"
IS_WINDOWS = platform.system() == "Windows"


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None  # missing or malformed — "not configured here"


def config_paths(project_root: Path) -> list[tuple[Path, str]]:
    """Every config Claude Code / Claude Desktop reads, in precedence order."""
    home = Path.home()
    paths = [
        (project_root / ".mcp.json", "project file"),
        (project_root / ".claude" / "mcp.json", "project file"),
        (home / ".claude" / "mcp.json", "user global"),
    ]
    if IS_WINDOWS:
        appdata = os.environ.get("APPDATA")
        if appdata:
            paths.append((Path(appdata) / "Claude" / "claude_desktop_config.json", "Claude Desktop"))
    elif platform.system() == "Darwin":
        paths.append((home / "Library" / "Application Support" / "Claude"
                      / "claude_desktop_config.json", "Claude Desktop"))
    else:
        paths.append((home / ".config" / "Claude" / "claude_desktop_config.json", "Claude Desktop"))
    return paths


def find_server(project_root: Path) -> tuple[bool, str]:
    """(found, where). Covers ~/.claude.json's per-project map, which is where
    `claude mcp add` writes by default and where naive checks miss it."""
    for path, label in config_paths(project_root):
        cfg = _load(path)
        if isinstance(cfg, dict) and SERVER_NAME in (cfg.get("mcpServers") or {}):
            return True, f"{label}: {path}"

    claude_json = Path.home() / ".claude.json"
    cfg = _load(claude_json)
    if isinstance(cfg, dict):
        if SERVER_NAME in (cfg.get("mcpServers") or {}):
            return True, f"user global: {claude_json}"
        projects = cfg.get("projects")
        if isinstance(projects, dict):
            here = str(project_root.resolve())
            other = None
            for directory, value in projects.items():
                if not isinstance(value, dict):
                    continue
                if SERVER_NAME not in (value.get("mcpServers") or {}):
                    continue
                try:
                    same = Path(directory).resolve() == Path(here)
                except OSError:
                    same = directory == here
                if same:
                    return True, f"project-scoped: {directory}"
                if other is None:
                    other = directory
            if other:
                # Registered, but under a different project — Claude Code will not
                # load it here, so treat it as missing and let --install fix it.
                return False, f"registered only under {other}, which is not this directory"
    return False, ""


def claude_cli() -> str | None:
    """Locate the Claude Code CLI. On Windows npm installs it as claude.cmd."""
    for name in (["claude", "claude.cmd", "claude.exe"] if IS_WINDOWS else ["claude"]):
        found = shutil.which(name)
        if found:
            return found
    return None


def install(scope: str) -> int:
    cli = claude_cli()
    if not cli:
        print("Claude Code CLI not on PATH — cannot register the server automatically.",
              file=sys.stderr)
        print(f"Install Claude Code, then run:\n"
              f"  claude mcp add --transport http --scope {scope} {SERVER_NAME} {SERVER_URL}",
              file=sys.stderr)
        return 2
    cmd = [cli, "mcp", "add", "--transport", "http", "--scope", scope, SERVER_NAME, SERVER_URL]
    print("$ " + " ".join(cmd))
    try:
        # shell=False everywhere; shutil.which already resolved the .cmd shim on Windows.
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except Exception as exc:  # noqa: BLE001
        print(f"failed to run the Claude CLI: {exc}", file=sys.stderr)
        return 2
    out = (result.stdout or "") + (result.stderr or "")
    print(out.strip())
    if result.returncode != 0:
        return 2
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--install", action="store_true", help="register the server if missing")
    ap.add_argument("--scope", default="user", choices=["user", "project", "local"],
                    help="user = every project on this machine (default); "
                         "project = write ./.mcp.json for teammates; local = this project only")
    ap.add_argument("--project-root", default=".", help="directory to treat as the project")
    args = ap.parse_args()

    root = Path(args.project_root).resolve()
    found, where = find_server(root)
    if found:
        print(f"excalidraw MCP: configured ({where})")
        return 0

    print(f"excalidraw MCP: NOT available here{' — ' + where if where else ''}.")
    if not args.install:
        print("Register it with:")
        print(f"  claude mcp add --transport http --scope user {SERVER_NAME} {SERVER_URL}")
        print("Everything except the live inline render works without it "
              "(excalidraw_build.py and excalidraw_lint.py are offline, stdlib-only).")
        return 1

    rc = install(args.scope)
    if rc != 0:
        return rc
    found, where = find_server(root)
    print(f"excalidraw MCP: {'configured (' + where + ')' if found else 'still not visible — restart Claude Code'}")
    print("Restart Claude Code (or reload the window) so the new server is picked up.")
    return 0 if found else 1


if __name__ == "__main__":
    raise SystemExit(main())
