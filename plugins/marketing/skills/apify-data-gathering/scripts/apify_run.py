#!/usr/bin/env python3
"""Budgeted Apify runner. Standard library only.

  apify_run.py limits
  apify_run.py search "google maps" [--limit 10]
  apify_run.py run <actor> --input input.json --max-usd 1 [--max-items 100]
                   [--out data.json] [--cache-hours 24] [--timeout 900] [--memory 1024]

Token: APIFY_TOKEN, else macOS Keychain service "apify-api-token".
The token is never printed. APIFY_API_BASE overrides https://api.apify.com (tests).
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("APIFY_API_BASE", "https://api.apify.com").rstrip("/")
KEYCHAIN_SERVICE = os.environ.get("APIFY_KEYCHAIN_SERVICE", "apify-api-token")
TERMINAL = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}
MIN_CHARGE_USD = 0.5  # Apify rejects maxTotalChargeUsd below this


def die(msg, code=1):
    print(f"apify_run: {msg}", file=sys.stderr)
    sys.exit(code)


def token(required=True):
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    if not tok and sys.platform == "darwin":
        try:
            tok = subprocess.run(
                ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            tok = ""
    if not tok and required:
        die("no token: set APIFY_TOKEN or add Keychain service "
            f"'{KEYCHAIN_SERVICE}' (Apify Console > Settings > API & Integrations)", 2)
    return tok


def call(method, path, params=None, body=None, auth=True):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if auth:
        req.add_header("Authorization", "Bearer " + token())
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            detail = e.read().decode(errors="replace")[:300]
            die(f"{method} {path} -> HTTP {e.code}: {detail}")
        except urllib.error.URLError as e:
            die(f"cannot reach {BASE} ({e.reason}); is api.apify.com allowed on this network?")
    die(f"{method} {path} kept failing after retries")


def actor_path(actor):
    return urllib.parse.quote(actor.replace("/", "~"), safe="~")


def cmd_limits(_args):
    d = call("GET", "/v2/users/me/limits").get("data", {})
    cur, lim = d.get("current", {}), d.get("limits", {})
    cyc = d.get("monthlyUsageCycle", {})
    used, cap = cur.get("monthlyUsageUsd"), lim.get("maxMonthlyUsageUsd")
    print(json.dumps({
        "cycle": [cyc.get("startAt"), cyc.get("endAt")],
        "monthlyUsageUsd": used,
        "maxMonthlyUsageUsd": cap,
        "remainingUsd": round(cap - used, 4) if isinstance(cap, (int, float)) and isinstance(used, (int, float)) else None,
        "activeActorJobs": cur.get("activeActorJobCount"),
        "maxConcurrentActorJobs": lim.get("maxConcurrentActorJobs"),
    }, indent=2))


def cmd_search(args):
    d = call("GET", "/v2/store", {"search": args.query, "limit": args.limit}, auth=False).get("data", {})
    for it in d.get("items", []):
        p = it.get("currentPricingInfo") or {}
        stats = it.get("stats") or {}
        print(f"{it.get('username')}/{it.get('name')}\t{p.get('pricingModel', '?')}\t"
              f"users={stats.get('totalUsers', '?')}\t{it.get('title', '')}")


def fresh(path, hours):
    return hours and os.path.exists(path) and (time.time() - os.path.getmtime(path)) < hours * 3600


def cmd_run(args):
    if args.max_usd is None or args.max_usd < MIN_CHARGE_USD:
        die(f"--max-usd is required and must be at least {MIN_CHARGE_USD} (Apify's minimum run cap)")
    out = args.out or f"apify-{args.actor.replace('/', '_')}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    if args.out and fresh(out, args.cache_hours):
        print(json.dumps({"cached": out, "ageHours": round((time.time() - os.path.getmtime(out)) / 3600, 2)}))
        return
    with open(args.input) as f:
        run_input = json.load(f)

    lim = call("GET", "/v2/users/me/limits").get("data", {})
    used = (lim.get("current") or {}).get("monthlyUsageUsd")
    cap = (lim.get("limits") or {}).get("maxMonthlyUsageUsd")
    if isinstance(used, (int, float)) and isinstance(cap, (int, float)) and cap - used < args.max_usd:
        die(f"monthly budget left ${cap - used:.2f} is below --max-usd {args.max_usd}", 3)

    run = call("POST", f"/v2/acts/{actor_path(args.actor)}/runs", {
        "maxTotalChargeUsd": args.max_usd,
        "maxItems": args.max_items,
        "timeout": args.timeout,
        "memory": args.memory,
    }, run_input).get("data", {})
    run_id = run.get("id")
    if not run_id:
        die("run did not start")
    print(f"started run {run_id}", file=sys.stderr)

    deadline = time.time() + (args.timeout or 3600) + 120
    while run.get("status") not in TERMINAL:
        if time.time() > deadline:
            die(f"gave up waiting; run {run_id} still {run.get('status')}")
        run = call("GET", f"/v2/actor-runs/{run_id}", {"waitForFinish": 60}).get("data", {})

    items = []
    ds = run.get("defaultDatasetId")
    if ds:
        offset = 0
        while True:
            page = call("GET", f"/v2/datasets/{ds}/items",
                        {"clean": "true", "format": "json", "offset": offset, "limit": 1000})
            if not isinstance(page, list) or not page:
                break
            items.extend(page)
            offset += len(page)
            if len(page) < 1000:
                break
    with open(out, "w") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)

    summary = {
        "actor": args.actor,
        "runId": run_id,
        "status": run.get("status"),
        "items": len(items),
        "usageTotalUsd": run.get("usageTotalUsd"),
        "maxUsd": args.max_usd,
        "out": out,
        "console": f"https://console.apify.com/view/runs/{run_id}",
    }
    print(json.dumps(summary, indent=2))
    if run.get("status") != "SUCCEEDED":
        sys.exit(4)


def main():
    ap = argparse.ArgumentParser(description="Budgeted Apify runner")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("limits").set_defaults(fn=cmd_limits)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=10)
    s.set_defaults(fn=cmd_search)
    r = sub.add_parser("run")
    r.add_argument("actor", help="username/actor-name or actor id")
    r.add_argument("--input", required=True, help="JSON file with the actor input")
    r.add_argument("--max-usd", type=float, help="hard cap for this run (maxTotalChargeUsd)")
    r.add_argument("--max-items", type=int, help="cap charged items for pay-per-result actors")
    r.add_argument("--out", help="where to write dataset items (JSON array)")
    r.add_argument("--cache-hours", type=float, default=0, help="reuse --out if younger than this")
    r.add_argument("--timeout", type=int, help="run timeout in seconds")
    r.add_argument("--memory", type=int, help="memory in MB (power of 2)")
    r.set_defaults(fn=cmd_run)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
